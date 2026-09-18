// Adaptador Zernio (WhatsApp con coexistencia). Formatos tomados del adaptador
// oficial de Zernio (github.com/zernio-dev/chat-sdk-adapter, src/types.ts y
// src/webhook.ts) y de docs.zernio.com/webhooks:
// - firma: X-Zernio-Signature = HMAC-SHA256 hex del body crudo con el secret
//   del endpoint (alias legado X-Late-Signature);
// - idempotencia: `id` del sobre (también X-Zernio-Event-Id);
// - reintentos: hasta 7 intentos si no hay 2xx en 5 s;
// - coexistencia: lo que el vendedor manda desde la app del celular llega
//   como `message.sent` con `source: "whatsapp_business_app"`.
//
// Los payloads de estado (message.delivered/read/failed) se leen de forma
// tolerante. Un evento que el CRM procesa pero cuyo formato no se reconoce
// sale "malformed": queda en dead-letter en webhook_events (nada se pierde).
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  SendFailedError,
  type MessagingProvider,
  type NormalizedAttachment,
  type NormalizedEvent,
  type NormalizedMessageType,
  type SendResult,
  type SendTextInput,
  type WebhookEnvelope,
} from "./provider";

const DEFAULT_BASE_URL = "https://zernio.com/api";
const SEND_TIMEOUT_MS = 15_000;

export function verifyZernioSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  if (!/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const envelopeSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
});

const attachmentSchema = z
  .object({
    type: z.string(),
    url: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const messageEventSchema = z.object({
  id: z.string(),
  event: z.enum(["message.received", "message.sent"]),
  timestamp: z.string().optional(),
  message: z
    .object({
      id: z.string(),
      conversationId: z.string(),
      platform: z.string(),
      platformMessageId: z.string().min(1),
      direction: z.enum(["incoming", "outgoing"]),
      text: z.string().nullable().optional(),
      attachments: z.array(attachmentSchema).optional().default([]),
      sender: z
        .object({
          id: z.string(),
          name: z.string().optional(),
          phoneNumber: z.string().optional(),
        })
        .passthrough(),
      sentAt: z.string(),
      source: z.string().optional(),
    })
    .passthrough(),
  conversation: z
    .object({
      id: z.string(),
      participantId: z.string().optional(),
      participantName: z.string().optional(),
    })
    .passthrough(),
  account: z.object({ id: z.string(), platform: z.string() }).passthrough(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // En eventos de eco, algunas versiones ponen `source` en el sobre.
  source: z.string().optional(),
});

const STATUS_BY_EVENT: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

function attachmentType(type: string): NormalizedMessageType {
  switch (type) {
    case "image":
    case "video":
    case "audio":
    case "sticker":
    case "location":
      return type;
    case "contact":
      return "contact";
    case "file":
      return "document";
    default:
      return "unknown";
  }
}

// Solo dígitos del teléfono, con "+" (Zernio a veces lo manda sin prefijo).
function phoneFromSender(sender: { id: string; phoneNumber?: string }, participantId?: string) {
  const candidate = sender.phoneNumber ?? participantId ?? sender.id;
  const digits = candidate.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : candidate;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Cuenta (número conectado) del evento. Zernio la documenta en
 * `account.accountId` (canónico) y `account.id`; se buscan también las formas
 * anidadas (`message.accountId`, `data.accountId`, `accountId`). Si dos
 * lugares traen ids DISTINTOS no se elige ninguno: sin cuenta, el webhook
 * rechaza el evento (falla cerrado).
 */
export function zernioAccountId(payload: unknown): string | undefined {
  const root = asRecord(payload);
  const account = asRecord(root.account);
  const candidates = [
    account.accountId,
    account.id,
    asRecord(root.message).accountId,
    asRecord(root.data).accountId,
    root.accountId,
  ]
    .map(asString)
    .filter((id): id is string => id !== undefined);
  const unique = new Set(candidates);
  return unique.size === 1 ? candidates[0] : undefined;
}

function findStatusFields(payload: Record<string, unknown>) {
  const message = (payload.message ?? payload.data ?? {}) as Record<string, unknown>;
  const error = (message.error ?? payload.error ?? {}) as Record<string, unknown>;
  return {
    providerAccountId: zernioAccountId(payload),
    providerMessageId: asString(message.platformMessageId) ?? asString(payload.platformMessageId),
    providerInternalId: asString(message.id) ?? asString(message.messageId) ?? asString(payload.messageId),
    errorCode: asString(error.code) ?? (typeof error.code === "number" ? String(error.code) : undefined),
    errorMessage: asString(error.message) ?? asString(message.errorMessage),
  };
}

export function normalizeZernioEvent(payload: unknown): NormalizedEvent {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return { kind: "ignored", eventId: "", event: "", reason: "sobre inválido", malformed: true };
  }
  const { id: eventId, event } = envelope.data;

  if (event === "message.received" || event === "message.sent") {
    const parsed = messageEventSchema.safeParse(payload);
    if (!parsed.success) {
      return { kind: "ignored", eventId, event, reason: `formato no reconocido: ${parsed.error.issues[0]?.message}`, malformed: true };
    }
    const { message, conversation, account, metadata } = parsed.data;
    if (account.platform !== "whatsapp") {
      return { kind: "ignored", eventId, event, reason: `plataforma ${account.platform}` };
    }
    // La MISMA cuenta que revisó la allowlist del webhook.
    const providerAccountId = zernioAccountId(payload);
    if (!providerAccountId) {
      return { kind: "ignored", eventId, event, reason: "cuenta ausente o contradictoria", malformed: true };
    }
    const outgoing = message.direction === "outgoing";
    // Documentado como "whatsapp_business_app" / "cloud_api"; se compara sin
    // separadores por si llega como "whatsappbusinessapp" o "WhatsApp-Business-App".
    const echoSource = (message.source ?? parsed.data.source ?? "").toLowerCase().replace(/[^a-z]/g, "");
    // "cloud_api" es el TRANSPORTE (API, dashboard de Zernio, difusiones,
    // automatizaciones), no prueba que lo haya escrito un vendedor: queda como
    // other_api. Un envío del propio CRM se reconoce al enlazar el eco con su
    // fila en cola (ingest.ts), que ya trae source "crm" y quién lo envió.
    const source = !outgoing ? "contact" : echoSource === "whatsappbusinessapp" ? "business_app" : "other_api";

    const attachments: NormalizedAttachment[] = message.attachments.map((a) => ({
      type: attachmentType(a.type),
      url: a.url,
      mimeType: asString(a.payload?.mimeType) ?? asString(a.payload?.mime_type),
      fileName: asString(a.payload?.filename) ?? asString(a.payload?.fileName),
      providerMediaId: asString(a.payload?.id),
      sha256: asString(a.payload?.sha256),
    }));
    const type: NormalizedMessageType =
      attachments[0]?.type ??
      (metadata?.interactiveType || metadata?.buttonPayload ? "interactive" : message.text ? "text" : "unknown");

    const sentAt = new Date(message.sentAt);
    return {
      kind: "message",
      eventId,
      providerAccountId,
      providerConversationId: conversation.id,
      direction: outgoing ? "out" : "in",
      source,
      providerMessageId: message.platformMessageId,
      providerInternalId: message.id,
      // En un eco saliente el "sender" es el negocio: el contacto es el participante.
      contactPhone: outgoing
        ? phoneFromSender({ id: conversation.participantId ?? "" }, conversation.participantId)
        : phoneFromSender(message.sender, conversation.participantId),
      contactName: outgoing ? conversation.participantName : (message.sender.name ?? conversation.participantName),
      type,
      body: message.text ?? null,
      attachments,
      sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
      referral:
        metadata?.referral && typeof metadata.referral === "object"
          ? (metadata.referral as Record<string, unknown>)
          : undefined,
    };
  }

  const status = STATUS_BY_EVENT[event];
  if (status) {
    const fields = findStatusFields(payload as Record<string, unknown>);
    if (!fields.providerMessageId && !fields.providerInternalId) {
      return { kind: "ignored", eventId, event, reason: "estado sin id de mensaje reconocible", malformed: true };
    }
    const ts = new Date(String((payload as Record<string, unknown>).timestamp ?? ""));
    return {
      kind: "status",
      eventId,
      status,
      ...fields,
      at: Number.isNaN(ts.getTime()) ? new Date() : ts,
    };
  }

  return { kind: "ignored", eventId, event, reason: "evento no procesado por el CRM" };
}

export class ZernioProvider implements MessagingProvider {
  readonly name = "zernio" as const;

  constructor(
    private readonly config: { apiKey: string; webhookSecret: string; baseUrl?: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const signature = headers.get("x-zernio-signature") ?? headers.get("x-late-signature");
    return verifyZernioSignature(rawBody, signature, this.config.webhookSecret);
  }

  readEnvelope(rawBody: string): WebhookEnvelope {
    const json: unknown = JSON.parse(rawBody);
    const parsed = envelopeSchema.parse(json);
    return { eventId: parsed.id, event: parsed.event, providerAccountId: zernioAccountId(json) };
  }

  normalize(payload: unknown): NormalizedEvent {
    return normalizeZernioEvent(payload);
  }

  // Media de WhatsApp vía Zernio: https://zernio.com/api/v1/whatsapp/media/{id}
  // exige el Bearer (sin él, 401; verificado en vivo). El Bearer SOLO se
  // agrega si la URL es del host de la API de Zernio: una URL de otro dominio
  // en un payload nunca recibe la API key.
  async fetchMedia(url: string, signal?: AbortSignal): Promise<Response> {
    const target = new URL(url);
    const api = new URL(this.config.baseUrl ?? DEFAULT_BASE_URL);
    if (target.protocol !== "https:") throw new ZernioSendError(0, "media_url_insegura", "La URL de media no es https");
    const headers: Record<string, string> = {};
    if (target.host === api.host) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return this.fetchImpl(target, { headers, signal, redirect: "follow" });
  }

  private apiUrl(path: string): string {
    return `${(this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}${path}`;
  }

  // Idempotency-Key: si la respuesta se pierde pero Zernio sí lo envió, el
  // reintento con la misma clave (24 h) devuelve la respuesta original en vez
  // de mandar otro mensaje. Zernio libera la clave cuando responde error, así
  // que un fallo AMBIGUO se marca "unknown" y se reconcilia antes de reintentar.
  async sendText({ providerAccountId, providerConversationId, text, idempotencyKey }: SendTextInput): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.apiUrl(`/v1/inbox/conversations/${encodeURIComponent(providerConversationId)}/messages`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ accountId: providerAccountId, message: text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout o corte de red: la petición pudo haber llegado.
      throw new ZernioSendError(0, "network", `Sin respuesta de Zernio: ${error instanceof Error ? error.message : String(error)}`, "unknown");
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const err = asRecord(json?.error);
      throw new ZernioSendError(
        res.status,
        asString(err.code) ?? String(res.status),
        asString(err.message) ?? asString(json?.message) ?? `Zernio respondió ${res.status}`,
        sendOutcomeForStatus(res.status),
      );
    }
    const data = asRecord(json?.data ?? json);
    const returned = asString(data.messageId) ?? asString(data.id);
    // 2xx sin id legible: Zernio lo aceptó, pero no se puede enlazar aún.
    if (!returned) throw new ZernioSendError(res.status, "sin_message_id", "Zernio no devolvió messageId", "unknown");
    // Según el endpoint, Zernio devuelve su id interno o directamente el wamid
    // de WhatsApp (visto en vivo: "wamid.HBg…").
    const isWamid = returned.startsWith("wamid.");
    return {
      providerInternalId: isWamid ? (asString(data.id) ?? returned) : returned,
      providerMessageId: asString(data.platformMessageId) ?? (isWamid ? returned : undefined),
    };
  }
}

/**
 * 4xx = Zernio/WhatsApp rechazó el mensaje: no salió. Excepciones ambiguas:
 * 408 (timeout), 409 (la misma clave sigue en vuelo) y 5xx.
 */
export function sendOutcomeForStatus(status: number): "rejected" | "unknown" {
  if (status === 408 || status === 409 || status >= 500) return "unknown";
  return "rejected";
}

export class ZernioSendError extends SendFailedError {
  constructor(
    readonly httpStatus: number,
    code: string,
    message: string,
    outcome: "rejected" | "unknown" = sendOutcomeForStatus(httpStatus),
  ) {
    super(code, message, outcome);
    this.name = "ZernioSendError";
  }
}
