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
// Los payloads de estado (message.delivered/read/failed) no están
// documentados: se leen de forma tolerante y, si no se reconocen, el evento
// queda "ignored" pero guardado crudo en webhook_events (nada se pierde).
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  MessagingProvider,
  NormalizedAttachment,
  NormalizedEvent,
  NormalizedMessageType,
  SendResult,
  SendTextInput,
  WebhookEnvelope,
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

function findStatusFields(payload: Record<string, unknown>) {
  const message = (payload.message ?? payload.data ?? {}) as Record<string, unknown>;
  const error = (message.error ?? payload.error ?? {}) as Record<string, unknown>;
  const account = (payload.account ?? {}) as Record<string, unknown>;
  return {
    providerAccountId: asString(account.id) ?? asString(message.accountId),
    providerMessageId: asString(message.platformMessageId) ?? asString(payload.platformMessageId),
    providerInternalId: asString(message.id) ?? asString(message.messageId) ?? asString(payload.messageId),
    errorCode: asString(error.code) ?? (typeof error.code === "number" ? String(error.code) : undefined),
    errorMessage: asString(error.message) ?? asString(message.errorMessage),
  };
}

export function normalizeZernioEvent(payload: unknown): NormalizedEvent {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return { kind: "ignored", eventId: "", event: "", reason: "sobre inválido" };
  }
  const { id: eventId, event } = envelope.data;

  if (event === "message.received" || event === "message.sent") {
    const parsed = messageEventSchema.safeParse(payload);
    if (!parsed.success) {
      return { kind: "ignored", eventId, event, reason: `formato no reconocido: ${parsed.error.issues[0]?.message}` };
    }
    const { message, conversation, account, metadata } = parsed.data;
    if (account.platform !== "whatsapp") {
      return { kind: "ignored", eventId, event, reason: `plataforma ${account.platform}` };
    }
    const outgoing = message.direction === "outgoing";
    const echoSource = message.source ?? parsed.data.source;
    const source = !outgoing
      ? "contact"
      : echoSource === "whatsapp_business_app"
        ? "business_app"
        : echoSource === "cloud_api"
          ? "crm"
          : "other_api";

    const attachments: NormalizedAttachment[] = message.attachments.map((a) => ({
      type: attachmentType(a.type),
      url: a.url,
      mimeType: asString(a.payload?.mimeType) ?? asString(a.payload?.mime_type),
      fileName: asString(a.payload?.filename) ?? asString(a.payload?.fileName),
    }));
    const type: NormalizedMessageType =
      attachments[0]?.type ??
      (metadata?.interactiveType || metadata?.buttonPayload ? "interactive" : message.text ? "text" : "unknown");

    const sentAt = new Date(message.sentAt);
    return {
      kind: "message",
      eventId,
      providerAccountId: account.id,
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
      return { kind: "ignored", eventId, event, reason: "estado sin id de mensaje reconocible" };
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
    const parsed = envelopeSchema.parse(JSON.parse(rawBody));
    return { eventId: parsed.id, event: parsed.event };
  }

  normalize(payload: unknown): NormalizedEvent {
    return normalizeZernioEvent(payload);
  }

  async sendText({ providerAccountId, providerConversationId, text }: SendTextInput): Promise<SendResult> {
    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const res = await this.fetchImpl(
      `${baseUrl}/v1/inbox/conversations/${encodeURIComponent(providerConversationId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountId: providerAccountId, message: text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error ?? {}) as Record<string, unknown>;
      throw new ZernioSendError(
        res.status,
        asString(err.code) ?? String(res.status),
        asString(err.message) ?? asString(json.message) ?? `Zernio respondió ${res.status}`,
      );
    }
    const data = (json.data ?? json) as Record<string, unknown>;
    const providerInternalId = asString(data.messageId) ?? asString(data.id);
    if (!providerInternalId) throw new ZernioSendError(res.status, "sin_message_id", "Zernio no devolvió messageId");
    return { providerInternalId, providerMessageId: asString(data.platformMessageId) };
  }
}

export class ZernioSendError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ZernioSendError";
  }
}
