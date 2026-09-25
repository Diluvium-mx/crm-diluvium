// Importador del historial del celular desde la API de Zernio (docs/numero-prueba.md).
// Zernio NO reenvía los webhooks de coexistencia de Meta (history, smb_app_state_sync):
// guarda los chats copiados en su bandeja, marcados `metadata.source:
// "coexistence_history"`, y los contactos de la app en su CRM. Aquí se LEEN (solo GET):
// - GET /v1/inbox/conversations?accountId=…            (docs.zernio.com → List conversations)
// - GET /v1/inbox/conversations/{id}/messages?accountId (docs.zernio.com → List messages;
//   `id` del mensaje = el wamid, el mismo que el webhook trae en platformMessageId)
// - GET /v1/contacts?accountId=…&platform=whatsapp      (docs.zernio.com → List contacts)
// Idempotente: el wamid único evita duplicados, así que se puede correr varias veces
// (Zernio puede terminar de copiar después de la primera pasada).
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import type { NormalizedAttachment, NormalizedMessageEvent, NormalizedMessageType } from "./provider";
import { isCoexistenceHistory, validDate } from "./zernio";

const DEFAULT_BASE_URL = "https://zernio.com/api";
const TIMEOUT_MS = 20_000;
/** Tope de páginas por listado: un chip de prueba tiene decenas; más = algo raro. */
const MAX_PAGES = 200;

const restAttachmentSchema = z
  .object({
    id: z.string().nullish(),
    type: z.string(),
    mimeType: z.string().nullish(),
    url: z.string().nullish(),
    filename: z.string().nullish(),
  })
  .passthrough();

const restMessageSchema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().nullish(),
    platform: z.string().nullish(),
    message: z.string().nullish(),
    senderId: z.string().nullish(),
    senderName: z.string().nullish(),
    direction: z.enum(["incoming", "outgoing"]),
    createdAt: z.string().nullish(),
    sentAt: z.string().nullish(),
    attachments: z.array(restAttachmentSchema).nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
    deliveryStatus: z.string().nullish(),
  })
  .passthrough();

export type RestConversation = { id: string; participantId: string | null; participantName: string | null };
export type RestMessage = z.infer<typeof restMessageSchema>;

function attachmentType(type: string): NormalizedMessageType {
  switch (type) {
    case "image":
    case "video":
    case "audio":
    case "sticker":
      return type;
    case "file":
      return "document";
    default:
      return "unknown";
  }
}

function asPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[\s()\-.]/g, "");
  return /^\+?\d{8,15}$/.test(compact) ? `+${compact.replace(/^\+/, "")}` : null;
}

/**
 * Mensaje de la API → evento normalizado del HISTORIAL. null si no es del historial
 * (lo vivo entra por el webhook) o si no se puede fechar (sin fecha no se inventa una).
 */
export function historyEventFromRest(
  accountId: string,
  conversation: RestConversation,
  raw: unknown,
): { event: NormalizedMessageEvent } | { skip: string } {
  const parsed = restMessageSchema.safeParse(raw);
  if (!parsed.success) return { skip: `formato no reconocido: ${parsed.error.issues[0]?.message}` };
  const m = parsed.data;
  if (!isCoexistenceHistory(m.metadata?.source)) return { skip: "no es historial" };
  if (m.platform && m.platform !== "whatsapp") return { skip: `plataforma ${m.platform}` };
  const sentAt = validDate(m.sentAt) ?? validDate(m.createdAt);
  if (!sentAt) return { skip: `sin fecha válida (${m.sentAt ?? m.createdAt ?? "vacía"})` };
  const outgoing = m.direction === "outgoing";
  const attachments: NormalizedAttachment[] = (m.attachments ?? [])
    .filter((a) => a.url)
    .map((a) => ({
      type: attachmentType(a.type),
      url: a.url!,
      mimeType: a.mimeType ?? undefined,
      fileName: a.filename ?? undefined,
      providerMediaId: a.id ?? undefined,
    }));
  const metadata = m.metadata ?? undefined;
  const type: NormalizedMessageType =
    attachments[0]?.type ??
    (metadata?.location ? "location" : metadata?.contacts ? "contact" : m.message ? "text" : "unknown");
  return {
    event: {
      kind: "message",
      eventId: `history-${m.id}`,
      providerAccountId: accountId,
      providerConversationId: conversation.id,
      direction: outgoing ? "out" : "in",
      source: outgoing ? "business_app" : "contact",
      providerMessageId: m.id,
      providerInternalId: "",
      contactPhone: asPhone(conversation.participantId) ?? (outgoing ? null : asPhone(m.senderId)),
      contactName: (outgoing ? conversation.participantName : (m.senderName ?? conversation.participantName)) ?? undefined,
      type,
      body: m.message ?? null,
      attachments,
      sentAt,
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
      history: true,
    },
  };
}

export class ZernioHistoryError extends Error {}

/** Lecturas GET de la API de Zernio para el historial. Nunca imprime la API key. */
export class ZernioHistoryClient {
  constructor(
    private readonly config: { apiKey: string; baseUrl?: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string): Promise<Record<string, unknown>> {
    const url = `${(this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ZernioHistoryError(`Sin respuesta de Zernio (${path.split("?")[0]}): ${error instanceof Error ? error.message : String(error)}`);
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok || !json || typeof json !== "object") {
      throw new ZernioHistoryError(`Zernio respondió ${res.status} en ${path.split("?")[0]}`);
    }
    return json as Record<string, unknown>;
  }

  /** Conversaciones de WhatsApp de la cuenta, todas las páginas. */
  async *conversations(accountId: string): AsyncGenerator<RestConversation> {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ accountId, platform: "whatsapp", limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const json = await this.get(`/v1/inbox/conversations?${params.toString()}`);
      const list = Array.isArray(json.data) ? json.data : Array.isArray(json.conversations) ? json.conversations : null;
      if (!list) throw new ZernioHistoryError("Listado de conversaciones con formato no reconocido");
      for (const raw of list as Record<string, unknown>[]) {
        if (typeof raw.id !== "string" || !raw.id) continue;
        if (raw.accountId && raw.accountId !== accountId) continue;
        yield {
          id: raw.id,
          participantId: typeof raw.participantId === "string" ? raw.participantId : null,
          participantName: typeof raw.participantName === "string" ? raw.participantName : null,
        };
      }
      const pagination = (json.pagination ?? {}) as Record<string, unknown>;
      cursor = typeof pagination.nextCursor === "string" && pagination.nextCursor ? pagination.nextCursor : undefined;
      if (!cursor || pagination.hasMore === false) return;
    }
    throw new ZernioHistoryError(`Más de ${MAX_PAGES} páginas de conversaciones: se detiene (revisar)`);
  }

  /** Mensajes de una conversación, del más viejo al más nuevo. */
  async *messages(accountId: string, conversationId: string): AsyncGenerator<unknown> {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ accountId, limit: "100", sortOrder: "asc" });
      if (cursor) params.set("cursor", cursor);
      const json = await this.get(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`);
      const list = Array.isArray(json.messages) ? json.messages : Array.isArray(json.data) ? json.data : null;
      if (!list) throw new ZernioHistoryError("Listado de mensajes con formato no reconocido");
      for (const raw of list) yield raw;
      const pagination = (json.pagination ?? {}) as Record<string, unknown>;
      cursor = typeof pagination.nextCursor === "string" && pagination.nextCursor ? pagination.nextCursor : undefined;
      if (!cursor || pagination.hasMore === false) return;
    }
    throw new ZernioHistoryError(`Más de ${MAX_PAGES} páginas de mensajes en ${conversationId}: se detiene (revisar)`);
  }

  /** Agenda de la app (contactos que Zernio importó): nombre + teléfono E.164. */
  async *contacts(accountId: string): AsyncGenerator<{ phoneE164: string; name: string }> {
    const limit = 100;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ accountId, platform: "whatsapp", limit: String(limit), skip: String(page * limit) });
      const json = await this.get(`/v1/contacts?${params.toString()}`);
      const list = Array.isArray(json.contacts) ? json.contacts : Array.isArray(json.data) ? json.data : null;
      if (!list) throw new ZernioHistoryError("Listado de contactos con formato no reconocido");
      for (const raw of list as Record<string, unknown>[]) {
        const name = typeof raw.name === "string" ? raw.name : "";
        const id = typeof raw.platformIdentifier === "string" ? raw.platformIdentifier : typeof raw.displayIdentifier === "string" ? raw.displayIdentifier : "";
        const phone = asPhone(id);
        if (!name || !phone) continue;
        try {
          yield { phoneE164: normalizePhone(phone), name };
        } catch {
          // teléfono que no es E.164 válido: se omite
        }
      }
      const pagination = (json.pagination ?? {}) as Record<string, unknown>;
      if (pagination.hasMore !== true || list.length === 0) return;
    }
    throw new ZernioHistoryError(`Más de ${MAX_PAGES} páginas de contactos: se detiene (revisar)`);
  }
}
