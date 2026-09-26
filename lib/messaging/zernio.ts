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
  type CreateTemplateInput,
  type CreateTemplateResult,
  type MessagingProvider,
  type NormalizedAttachment,
  type NormalizedEvent,
  type NormalizedMessageType,
  type ProviderTemplate,
  type SendResult,
  type SendMediaInput,
  type SendTemplateInput,
  type SendTextInput,
  type WebhookEnvelope,
} from "./provider";
import { bodyHasUnsupportedPlaceholders, templateRequiresUnsupportedParams, templateVariablesFromBody } from "./template-format";
import { clickFromZernioConversation, extractReferral, type ConversationClick } from "@/lib/ads/referral";

const DEFAULT_BASE_URL = "https://zernio.com/api";
// Respaldo de anuncios por el listado de conversaciones (docs.zernio.com,
// "List conversations", revisado el 25-sep-2026): `sortOrder` por "updated time",
// `desc` por omisión; `limit` de 1 a 100 (50 por omisión); cursor opaco.
const CONVERSATION_PAGE_SIZE = 100;
/** Sin hora del mensaje (o sin `updatedTime` en la respuesta): páginas fijas, como antes. */
const CONVERSATION_PAGES = 3;
/**
 * Con la hora del mensaje se sigue hasta PASAR esa hora (la conversación del
 * mensaje se actualizó entonces: no puede estar más abajo). Tope de seguridad:
 * 10 páginas = 1,000 conversaciones actualizadas desde el mensaje; a ~400
 * clientes nuevos al día ni el último reintento (~40 min) se acerca.
 */
const CONVERSATION_MAX_PAGES = 10;
/** Holgura contra desfase de relojes (hora de WhatsApp vs. `updatedTime` de Zernio). */
const CONVERSATION_SKEW_MS = 5 * 60_000;
const SEND_TIMEOUT_MS = 15_000;

export function verifyZernioSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  if (!/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// El id del evento puede faltar en el cuerpo (el ejemplo de CTWA que Zernio
// mandó por escrito el 24-sep-2026 es "plano" y no lo trae): ver zernioEventId.
const envelopeSchema = z.object({
  id: z.string().min(1).optional(),
  event: z.string().min(1),
});

const attachmentSchema = z
  .object({
    type: z.string(),
    url: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const conversationSchema = z
  .object({
    id: z.string(),
    participantId: z.string().nullish(),
    participantName: z.string().nullish(),
  })
  .passthrough();

const messageEventSchema = z.object({
  id: z.string().optional(),
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
      // phoneNumber es "string,null" en la doc: null/ausente cuando el cliente
      // usa nombre de usuario de WhatsApp (BSUID, 2026+). Nunca debe tumbar el
      // parseo del mensaje: la identidad cae a businessScopedUserId.
      sender: z
        .object({
          id: z.string().nullish(),
          name: z.string().nullish(),
          phoneNumber: z.string().nullish(),
          businessScopedUserId: z.string().nullish(),
        })
        .passthrough(),
      // Puede faltar (formato plano): se usa la hora del sobre o la de recepción.
      sentAt: z.string().nullish(),
      source: z.string().optional(),
    })
    .passthrough(),
  conversation: conversationSchema,
  account: z.object({ id: z.string(), platform: z.string() }).passthrough(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  // En eventos de eco, algunas versiones ponen `source` en el sobre.
  source: z.string().optional(),
});

// reaction.received (docs.zernio.com/webhooks/inbox#reactionreceived).
const reactionEventSchema = z.object({
  id: z.string(),
  event: z.literal("reaction.received"),
  reaction: z
    .object({
      emoji: z.string(),
      action: z.enum(["added", "removed"]),
      platformMessageId: z.string().min(1),
      sender: z.object({ id: z.string(), phoneNumber: z.string().nullish() }).passthrough(),
      reactedAt: z.string(),
    })
    .passthrough(),
  conversation: conversationSchema,
  account: z.object({ id: z.string(), platform: z.string() }).passthrough(),
  timestamp: z.string().nullish(),
});

// message.edited / message.deleted (docs.zernio.com/webhooks/inbox).
const messageChangeEventSchema = z.object({
  id: z.string(),
  event: z.enum(["message.edited", "message.deleted"]),
  message: z
    .object({ platformMessageId: z.string().min(1), text: z.string().nullish() })
    .passthrough(),
  editHistory: z.array(z.unknown()).nullish(),
  editedAt: z.string().nullish(),
  deletedAt: z.string().nullish(),
  timestamp: z.string().nullish(),
  account: z.object({ id: z.string(), platform: z.string() }).passthrough(),
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

// Un valor es teléfono solo si, sin separadores, son 8-15 dígitos con o sin
// "+" (Zernio a veces lo manda sin prefijo). Un BSUID ("MX.1446…") o cualquier
// otro id NO se convierte en teléfono: antes se le sacaban los dígitos y
// terminaba descartado o, peor, como un contacto con número inventado.
function asPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[\s()\-.]/g, "");
  return /^\+?\d{8,15}$/.test(compact) ? `+${compact.replace(/^\+/, "")}` : null;
}

// Forma del BSUID de Meta: país ISO + "." + dígitos (visto en prod: "MX.1446369767399131").
const BSUID_PATTERN = /^[A-Z]{2}\.[0-9A-Za-z]+$/;
function asBsuid(value: string | null | undefined): string | undefined {
  return value && BSUID_PATTERN.test(value) ? value : undefined;
}

function firstOf<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) if (value !== null && value !== undefined) return value;
  return null;
}

// ISO 8601 COMPLETO y con zona (Z u offset). Sin zona, el instante dependería
// de la TZ del servidor; por eso se rechaza.
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
/** Un evento no puede venir de más de un día en el futuro (reloj roto o dato corrupto). */
const MAX_FUTURE_SKEW_MS = 24 * 3_600_000;

/**
 * Fecha de un webhook, estricta: ISO con zona, fecha de calendario REAL (Node
 * convierte "2026-02-30" en 2 de marzo sin avisar) y no más de un día en el
 * futuro (una fecha absurda bloquearía para siempre reacciones/ediciones
 * posteriores y abriría ventanas de 24 h falsas). Si no, null.
 */
export function validDate(value: string | null | undefined, now = Date.now()): Date | null {
  if (!value) return null;
  const m = ISO_WITH_ZONE.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() > now + MAX_FUTURE_SKEW_MS) return null;
  return date;
}

/** ¿Alguna de las marcas de origen dice "coexistence_history"? (sin separadores ni mayúsculas) */
export function isCoexistenceHistory(...sources: unknown[]): boolean {
  return sources.some((s) => typeof s === "string" && s.toLowerCase().replace(/[^a-z]/g, "") === "coexistencehistory");
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

/**
 * Id del evento (idempotencia del webhook): `id` del sobre → encabezado
 * X-Zernio-Event-Id → DERIVADO del wamid (`message.received-wamid.…`). El
 * derivado es estable: un reintento del mismo mensaje cae en la misma fila y
 * no se procesa dos veces. Sin ninguno de los tres, undefined.
 */
export function zernioEventId(payload: unknown, headers?: Headers): string | undefined {
  const root = asRecord(payload);
  const explicit = asString(root.id) ?? asString(headers?.get("x-zernio-event-id") ?? undefined);
  if (explicit) return explicit;
  const event = asString(root.event);
  const wamid = asString(asRecord(root.message).platformMessageId) ?? asString(root.platformMessageId);
  return event && wamid ? `${event}-${wamid}` : undefined;
}

/**
 * Hora que trae el id interno de Zernio: es un ObjectId de Mongo (24 hex; los
 * primeros 8 = segundos Unix de su creación; visto: 6ab2d706… = 19:29:10Z para
 * un sentAt de 19:29:09Z). Mejor respaldo que la hora de recepción cuando
 * Zernio entrega tarde (reintentos). Solo si es verosímil: no después de la
 * recepción ni más de 7 días antes.
 */
export function objectIdTime(id: string | undefined, receivedAt?: Date): Date | null {
  if (!id || !/^[0-9a-f]{24}$/i.test(id)) return null;
  const date = new Date(parseInt(id.slice(0, 8), 16) * 1000);
  const ref = receivedAt?.getTime() ?? Date.now();
  if (date.getTime() > ref + 60_000 || date.getTime() < ref - 7 * 86_400_000) return null;
  return date;
}

/**
 * Mensaje en formato PLANO (campos en la raíz: messageId, conversationId,
 * platformMessageId, text, sender…, como el ejemplo de CTWA de Zernio) → la
 * forma anidada (`message: {…}`) que reciben los webhooks reales. Si ya viene
 * anidado, se devuelve igual.
 */
function nestFlatMessage(payload: unknown): unknown {
  const root = asRecord(payload);
  if (root.message && typeof root.message === "object") return payload;
  const wamid = asString(root.platformMessageId);
  if (!wamid) return payload;
  return {
    ...root,
    message: {
      id: asString(root.messageId) ?? wamid,
      conversationId: asString(root.conversationId) ?? asString(asRecord(root.conversation).id),
      platform: asString(root.platform) ?? asString(asRecord(root.account).platform),
      platformMessageId: wamid,
      direction: asString(root.direction) ?? (root.event === "message.sent" ? "outgoing" : "incoming"),
      text: typeof root.text === "string" ? root.text : null,
      attachments: Array.isArray(root.attachments) ? root.attachments : [],
      sender: asRecord(root.sender),
      sentAt: asString(root.sentAt),
      source: asString(root.source),
    },
  };
}

export function normalizeZernioEvent(payload: unknown, context: { receivedAt?: Date } = {}): NormalizedEvent {
  const envelope = envelopeSchema.safeParse(payload);
  const eventId = zernioEventId(payload) ?? "";
  if (!envelope.success || !eventId) {
    return { kind: "ignored", eventId, event: envelope.data?.event ?? "", reason: "sobre inválido", malformed: true };
  }
  const { event } = envelope.data;

  if (event === "message.received" || event === "message.sent") {
    payload = nestFlatMessage(payload);
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
    // Copia del historial del celular (coexistencia): Zernio la marca con
    // source "coexistence_history" (docs.zernio.com, List messages → metadata).
    // No se sabe si además dispara webhooks; si llega, NUNCA se trata como vivo.
    const history = isCoexistenceHistory(message.source, parsed.data.source, metadata?.source);
    // En el historial, lo saliente lo escribió el negocio desde la app del celular.
    const source = !outgoing
      ? "contact"
      : echoSource === "whatsappbusinessapp" || history
        ? "business_app"
        : "other_api";

    const attachments: NormalizedAttachment[] = message.attachments.map((a) => ({
      type: attachmentType(a.type),
      url: a.url,
      mimeType: asString(a.payload?.mimeType) ?? asString(a.payload?.mime_type),
      fileName: asString(a.payload?.filename) ?? asString(a.payload?.fileName),
      providerMediaId: asString(a.payload?.id),
      sha256: asString(a.payload?.sha256),
    }));
    // La ubicación y las tarjetas de contacto viajan en metadata; el texto es
    // solo la vista previa ("📍 …", "👤 …").
    const type: NormalizedMessageType =
      attachments[0]?.type ??
      (metadata?.location
        ? "location"
        : metadata?.contacts
          ? "contact"
          : metadata?.interactiveType || metadata?.buttonPayload
            ? "interactive"
            : message.text
              ? "text"
              : "unknown");

    // sentAt gobierna el orden del hilo, la ventana de 24 h y la primera
    // respuesta: un valor ilegible NO se sustituye por "ahora" (abriría una
    // ventana falsa y corrompería métricas). Se marca malformado → dead-letter.
    // Si NO viene (formato plano), se usa la hora del sobre y, sin ella, la de
    // RECEPCIÓN del webhook (guardada al llegar, no la del reproceso): un
    // mensaje de anuncio nunca se queda fuera por no traer hora.
    let sentAt: Date | null;
    let sentAtFromReceipt = false;
    if (message.sentAt) {
      sentAt = validDate(message.sentAt);
      if (!sentAt) {
        return { kind: "ignored", eventId, event, reason: `sentAt inválido: ${message.sentAt}`, malformed: true };
      }
    } else {
      sentAt = validDate(parsed.data.timestamp) ?? objectIdTime(message.id, context.receivedAt) ?? context.receivedAt ?? null;
      sentAtFromReceipt = true;
      if (!sentAt) return { kind: "ignored", eventId, event, reason: "mensaje sin hora", malformed: true };
    }
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
        ? asPhone(conversation.participantId)
        : firstOf(asPhone(message.sender.phoneNumber), asPhone(message.sender.id), asPhone(conversation.participantId)),
      contactBsuid: outgoing
        ? asBsuid(conversation.participantId)
        : (asBsuid(message.sender.businessScopedUserId) ?? asBsuid(message.sender.id) ?? asBsuid(conversation.participantId)),
      contactName:
        (outgoing ? conversation.participantName : (message.sender.name ?? conversation.participantName)) ?? undefined,
      type,
      body: message.text ?? null,
      attachments,
      sentAt,
      ...(sentAtFromReceipt ? { sentAtFromReceipt } : {}),
      // Ficha del anuncio: raíz → metadata.referral (Zernio manda ambas). Solo
      // en entrantes: es del cliente que tocó el anuncio.
      referral: outgoing ? undefined : extractReferral(payload),
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
      ...(history ? { history: true } : {}),
    };
  }

  if (event === "reaction.received") {
    const parsed = reactionEventSchema.safeParse(payload);
    if (!parsed.success) {
      return { kind: "ignored", eventId, event, reason: `formato no reconocido: ${parsed.error.issues[0]?.message}`, malformed: true };
    }
    const { reaction, conversation, account } = parsed.data;
    if (account.platform !== "whatsapp") return { kind: "ignored", eventId, event, reason: `plataforma ${account.platform}` };
    const providerAccountId = zernioAccountId(payload);
    if (!providerAccountId) return { kind: "ignored", eventId, event, reason: "cuenta ausente o contradictoria", malformed: true };
    // Doc de Zernio: quien reacciona "usually the participant", pero es el
    // negocio si reaccionó desde la app o la API → comparar con participantId.
    const participant = conversation.participantId ?? "";
    const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
    const fromContact =
      reaction.sender.id === participant ||
      (digits(participant) !== "" &&
        (digits(reaction.sender.id) === digits(participant) || digits(reaction.sender.phoneNumber) === digits(participant)));
    // Hora confiable o nada: sin ella no se puede ordenar (una reacción vieja
    // reprocesada con la hora de "ahora" pisaría a una posterior) → dead-letter.
    const at = validDate(reaction.reactedAt) ?? validDate(parsed.data.timestamp);
    if (!at) return { kind: "ignored", eventId, event, reason: "reacción sin hora válida", malformed: true };
    return {
      kind: "reaction",
      eventId,
      providerAccountId,
      providerMessageId: reaction.platformMessageId,
      side: fromContact ? "contact" : "business",
      emoji: reaction.emoji,
      action: reaction.action,
      at,
    };
  }

  if (event === "message.edited" || event === "message.deleted") {
    const parsed = messageChangeEventSchema.safeParse(payload);
    if (!parsed.success) {
      return { kind: "ignored", eventId, event, reason: `formato no reconocido: ${parsed.error.issues[0]?.message}`, malformed: true };
    }
    const data = parsed.data;
    if (data.account.platform !== "whatsapp") return { kind: "ignored", eventId, event, reason: `plataforma ${data.account.platform}` };
    const providerAccountId = zernioAccountId(payload);
    if (!providerAccountId) return { kind: "ignored", eventId, event, reason: "cuenta ausente o contradictoria", malformed: true };
    const at = validDate(event === "message.edited" ? data.editedAt : data.deletedAt) ?? validDate(data.timestamp);
    if (!at) return { kind: "ignored", eventId, event, reason: "cambio de mensaje sin hora válida", malformed: true };
    return {
      kind: "message_change",
      eventId,
      providerAccountId,
      providerMessageId: data.message.platformMessageId,
      change: event === "message.edited" ? "edited" : "deleted",
      body: event === "message.edited" ? (data.message.text ?? null) : undefined,
      editHistory: data.editHistory ?? undefined,
      at,
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

  readEnvelope(rawBody: string, headers?: Headers): WebhookEnvelope {
    const json: unknown = JSON.parse(rawBody);
    const parsed = envelopeSchema.parse(json);
    const eventId = zernioEventId(json, headers);
    if (!eventId) throw new Error("evento sin id (ni en el cuerpo, ni en X-Zernio-Event-Id, ni wamid)");
    return { eventId, event: parsed.event, providerAccountId: zernioAccountId(json) };
  }

  normalize(payload: unknown, context?: { receivedAt?: Date }): NormalizedEvent {
    return normalizeZernioEvent(payload, context);
  }

  // Anuncios (respaldo): primer clic que Zernio guardó en la conversación.
  // Documentación oficial (docs.zernio.com, 25-sep-2026):
  // - "Get conversation" (GET /v1/inbox/conversations/{id}) "currently returns
  //   only the `meta_ad_*` family" (Instagram/Messenger); los `ctwa_*` de
  //   WhatsApp "are returned by `GET /v1/inbox/conversations` instead".
  // - "Click-to-WhatsApp Ads" (/platforms/whatsapp/ctwa): el clic queda en la
  //   conversación bajo `metadata` (ctwa_clid, ctwa_captured_at, ctwa_source_id,
  //   ctwa_source_url, ctwa_headline, ctwa_source_type).
  // Por eso se lista por cuenta (filtro `accountId`, verificado en vivo: solo
  // devuelve esa cuenta) y se busca la conversación por id. El listado va de la
  // más reciente a la más vieja (por actualización): con `updatedSince` (la hora
  // del mensaje) se recorre hasta pasar esa hora, así el volumen del día no la
  // saca de la ventana; no encontrarla ahí = sin datos (se reintenta). Si Zernio
  // avisa que no pudo leer la cuenta (`meta.accountsFailed`), es un error, no "sin datos".
  async conversationAdClick(
    providerAccountId: string,
    providerConversationId: string,
    opts: { updatedSince?: Date } = {},
  ): Promise<ConversationClick | null> {
    const floor = opts.updatedSince ? opts.updatedSince.getTime() - CONVERSATION_SKEW_MS : null;
    let cursor: string | undefined;
    let bounded = floor !== null;
    for (let page = 0; page < (bounded ? CONVERSATION_MAX_PAGES : CONVERSATION_PAGES); page++) {
      const params = new URLSearchParams({ accountId: providerAccountId, limit: String(CONVERSATION_PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      const json = await this.apiJson("GET", `/v1/inbox/conversations?${params.toString()}`);
      const list = Array.isArray(json.data) ? json.data.map(asRecord) : null;
      if (!list) throw new ZernioApiError(0, "Listado de conversaciones con formato no reconocido");
      const failed = Number(asRecord(json.meta).accountsFailed ?? 0);
      if (failed > 0) throw new ZernioApiError(0, "Zernio no pudo leer la cuenta en el listado (meta.accountsFailed); se reintenta");
      const found = list.find((c) => c.id === providerConversationId);
      if (found) return clickFromZernioConversation({ data: found });
      const pagination = asRecord(json.pagination);
      cursor = asString(pagination.nextCursor);
      if (pagination.hasMore !== true || !cursor) return null;
      if (bounded) {
        // Cualquier conversación de esta página ya es anterior a la hora del
        // mensaje → todo lo que sigue también: la del mensaje no está más abajo.
        const times = list.map((c) => Date.parse(String(c.updatedTime ?? "")));
        if (times.some((t) => Number.isNaN(t))) bounded = false; // sin hora legible: páginas fijas
        else if (Math.min(...times) < floor!) return null;
      }
    }
    if (bounded) {
      throw new ZernioApiError(0, `Más de ${CONVERSATION_MAX_PAGES} páginas de conversaciones actualizadas desde el mensaje; se reintenta`);
    }
    return null;
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
    return this.postToConversation(providerConversationId, { accountId: providerAccountId, message: text }, idempotencyKey);
  }

  // Envía una plantilla aprobada por el MISMO endpoint que el texto. Cuerpo
  // tomado del adaptador oficial (src/api-client.ts sendTemplate + types.ts
  // ZernioSendMessageBody.template): { accountId, template: { elements: [{ name,
  // language, components }] } }. Los `components` solo van si hay variables; los
  // parameters siguen el objeto `template` de la Cloud API (posicional).
  async sendTemplate({ providerAccountId, providerConversationId, name, language, bodyParams, idempotencyKey }: SendTemplateInput): Promise<SendResult> {
    const element: Record<string, unknown> = { name, language };
    if (bodyParams.length > 0) {
      element.components = [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }];
    }
    return this.postToConversation(
      providerConversationId,
      { accountId: providerAccountId, template: { elements: [element] } },
      idempotencyKey,
    );
  }

  // Media saliente (Fase D). Cuerpo verificado en vivo contra el sandbox
  // (docs/fase-d-diseno.md §0.3): attachmentUrl (pública) + attachmentType
  // image|video|audio|file + attachmentName (documentos) + message (pie).
  // El objeto `media: {url,type}` de la guía del inbox NO funciona (400).
  async sendMedia({ providerAccountId, providerConversationId, url, kind, caption, fileName, idempotencyKey }: SendMediaInput): Promise<SendResult> {
    const target = new URL(url);
    if (target.protocol !== "https:") throw new ZernioSendError(0, "media_url_insegura", "La URL del archivo debe ser https", "rejected");
    const body: Record<string, unknown> = {
      accountId: providerAccountId,
      attachmentUrl: url,
      attachmentType: kind === "document" ? "file" : kind,
    };
    if (kind === "document" && fileName) body.attachmentName = fileName;
    if (caption) body.message = caption;
    return this.postToConversation(providerConversationId, body, idempotencyKey);
  }

  // GET /v1/whatsapp/templates?accountId=… (docs.zernio.com). FALLA CERRADO:
  // la sincronización usa esta lista como censo COMPLETO y marca REMOVED lo
  // ausente (lib/messaging/templates.ts). Por eso una respuesta ilegible,
  // con formato desconocido, con una fila sin identidad, o cortada por el tope
  // de páginas con más por leer, LANZA — nunca devuelve una lista parcial que
  // haría desaparecer plantillas válidas. apiJson ya lanza ante JSON ilegible.
  async listTemplates(providerAccountId: string): Promise<ProviderTemplate[]> {
    const out: ProviderTemplate[] = [];
    let cursor: string | undefined;
    const MAX_PAGES = 20; // una PyME tiene decenas; más = algo raro, se aborta
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ accountId: providerAccountId });
      if (cursor) params.set("cursor", cursor);
      const json = await this.apiJson("GET", `/v1/whatsapp/templates?${params.toString()}`);
      const list = Array.isArray(json.templates)
        ? json.templates
        : Array.isArray(json.data)
          ? json.data
          : null;
      if (list === null) {
        throw new ZernioApiError(0, "Respuesta de plantillas con formato no reconocido; se aborta la sincronización");
      }
      for (const raw of list) out.push(parseProviderTemplate(asRecord(raw)));
      const pagination = asRecord(json.pagination);
      // Censo COMPLETO solo si el proveedor no indica más páginas.
      if (pagination.hasMore === false) return out;
      const next = asString(pagination.nextCursor);
      if (next) {
        cursor = next;
        continue;
      }
      // Sin cursor pero con hasMore:true la respuesta está DEGRADADA (dice que
      // hay más pero no da cómo pedirlas): abortar, no tratar la lista parcial
      // como censo. Sin ninguna señal de más páginas, es una sola página completa.
      if (pagination.hasMore === true) {
        throw new ZernioApiError(0, "Zernio indicó más plantillas (hasMore) sin nextCursor; se aborta para no borrar plantillas válidas");
      }
      return out;
    }
    // Se agotó el tope de páginas con un cursor todavía pendiente: la lista
    // estaría incompleta. Abortar es preferible a marcar plantillas como
    // eliminadas por no haberlas leído.
    throw new ZernioApiError(0, `Más de ${MAX_PAGES} páginas de plantillas; se aborta para no borrar plantillas válidas`);
  }

  // POST /v1/whatsapp/templates (docs.zernio.com). Queda PENDING hasta que Meta
  // la revise; el resultado llega por el webhook whatsapp.template.status_updated
  // o al volver a sincronizar.
  async createTemplate({ providerAccountId, name, language, category, bodyText, bodyExample }: CreateTemplateInput): Promise<CreateTemplateResult> {
    const bodyComponent: Record<string, unknown> = { type: "body", text: bodyText };
    if (bodyExample.length > 0) bodyComponent.example = { body_text: [bodyExample] };
    const json = await this.apiJson("POST", `/v1/whatsapp/templates`, {
      accountId: providerAccountId,
      name,
      language,
      category,
      components: [bodyComponent],
    });
    const data = asRecord(json.data ?? json);
    return {
      providerTemplateId: asString(data.id) ?? asString(data.templateId) ?? null,
      status: asString(data.status) ?? "PENDING",
    };
  }

  // POST al endpoint de mensajes de la conversación con clasificación de
  // resultado idéntica para texto y plantilla (mismo endpoint, misma clave de
  // idempotencia): lo único que cambia entre ambos es el `body`.
  private async postToConversation(
    providerConversationId: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.apiUrl(`/v1/inbox/conversations/${encodeURIComponent(providerConversationId)}/messages`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
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

  // GET/POST JSON a la API de Zernio (plantillas). Distinto de postToConversation:
  // un fallo aquí NO es un envío ambiguo (no hay mensaje que duplicar), así que
  // lanza ZernioApiError con el código HTTP, no SendFailedError.
  private async apiJson(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.apiUrl(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ZernioApiError(0, `Sin respuesta de Zernio: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const err = asRecord(asRecord(parsed).error);
      throw new ZernioApiError(
        res.status,
        asString(err.message) ?? asString(asRecord(parsed).message) ?? `Zernio respondió ${res.status}`,
        asString(err.code),
      );
    }
    // Un 2xx con cuerpo ilegible o que no es un objeto JSON NO se trata como
    // vacío: la sincronización lo usa como censo y un [] falso borraría
    // plantillas válidas. Se lanza para que falle cerrado.
    if (parsed === null || typeof parsed !== "object") {
      throw new ZernioApiError(res.status, "Respuesta de Zernio ilegible (se esperaba un objeto JSON)");
    }
    return parsed as Record<string, unknown>;
  }
}

/** Componente BODY de una plantilla: su texto y los ejemplos de sus variables. */
function bodyOfComponents(components: unknown): { text: string | null; examples: string[] } {
  const comps = Array.isArray(components) ? components.map(asRecord) : [];
  const body = comps.find((c) => asString(c.type)?.toUpperCase() === "BODY");
  const text = body ? (asString(body.text) ?? null) : null;
  const rows = asRecord(body?.example).body_text;
  const examples = Array.isArray(rows) && Array.isArray(rows[0]) ? (rows[0] as unknown[]).map((v) => String(v)) : [];
  return { text, examples };
}

/**
 * Normaliza una fila del listado de Zernio a ProviderTemplate. ESTRICTO: una
 * fila sin identidad (name/language) o sin status es un formato inesperado y
 * LANZA — no se omite. Motivo: la sincronización trata la lista como censo
 * completo; una fila descartada en silencio se leería como "eliminada" y
 * marcaría REMOVED una plantilla que en realidad sigue viva.
 */
function parseProviderTemplate(raw: Record<string, unknown>): ProviderTemplate {
  const name = asString(raw.name);
  const language = asString(raw.language);
  const status = asString(raw.status);
  if (!name || !language || !status) {
    throw new ZernioApiError(0, `Plantilla de Zernio con campos faltantes (name/language/status): ${JSON.stringify(raw).slice(0, 160)}`);
  }
  const { text, examples } = bodyOfComponents(raw.components);
  // No enviable desde el CRM si necesita params de encabezado/botón, si el
  // cuerpo usa variables con nombre / fuera de rango / con huecos, o si Meta
  // marca la plantilla como de parámetros NOMBRADOS (parameter_format).
  const requiresUnsupportedParams =
    templateRequiresUnsupportedParams(raw.components) ||
    bodyHasUnsupportedPlaceholders(text) ||
    asString(raw.parameter_format)?.toUpperCase() === "NAMED";
  return {
    providerTemplateId: asString(raw.id) ?? null,
    name,
    language,
    category: asString(raw.category) ?? null,
    status,
    bodyText: text,
    variables: templateVariablesFromBody(text, examples),
    requiresUnsupportedParams,
  };
}

/** Fallo de un endpoint de plantillas (listar/crear). No es un envío ambiguo. */
export class ZernioApiError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ZernioApiError";
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
