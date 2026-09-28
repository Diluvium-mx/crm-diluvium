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
//
// Escala del número oficial (1,000+ chats, decenas de miles de mensajes):
// - Límite de Zernio (docs.zernio.com/rate-limits): 60 peticiones/min con 0–2 cuentas
//   conectadas, COMPARTIDAS con el CRM en vivo (envíos, media). El cliente va a su
//   propio ritmo (40/min), lee X-RateLimit-Remaining/Reset y deja una reserva (20) para el
//   CRM; con 429 espera Retry-After y repite la MISMA petición; con 5xx/red/timeout
//   reintenta con espera creciente (2 s, 4 s, 8 s … 60 s).
// - Paginación sin huecos: conversaciones en orden ASCENDENTE por actualización (una
//   conversación que se mueve mientras se pagina va al final: se ve dos veces, nunca
//   cero), también las archivadas; un cursor repetido, `hasMore` sin cursor o una
//   respuesta parcial (`meta.accountsFailed`) detienen la corrida en vez de saltarse páginas.
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import type { NormalizedAttachment, NormalizedMessageEvent, NormalizedMessageType } from "./provider";
import { isCoexistenceHistory, validDate } from "./zernio";

const DEFAULT_BASE_URL = "https://zernio.com/api";
const TIMEOUT_MS = 30_000;
/** Topes de páginas (solo contra un bucle del proveedor; nunca se alcanzan con datos reales). */
const MAX_CONVERSATION_PAGES = 5_000; // 500,000 chats
const MAX_MESSAGE_PAGES = 5_000; // 500,000 mensajes en un solo chat
const MAX_CONTACT_PAGES = 2_000; // 400,000 contactos
/**
 * Ritmo propio por omisión: 1 petición cada 1.5 s = 40/min. El plan gratuito da 60/min
 * y un 429 en un envío del vendedor o del bot lo retrasa (espera su turno; Bloque B):
 * quedan ~20/min para el CRM en vivo (envíos, descargas de media), que trabaja normal
 * mientras la importación corre en segundo plano.
 */
export const DEFAULT_MIN_INTERVAL_MS = 1_500;
/**
 * Si Zernio dice que quedan estas o menos en la ventana, el importador espera al
 * reinicio: cuando el bot o los vendedores usan más, el importador cede.
 */
export const DEFAULT_RATE_RESERVE = 20;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_MAX_THROTTLED = 40;
const MAX_BACKOFF_MS = 60_000;
/** Espera máxima que se acepta de Zernio (Retry-After / reinicio de ventana); más = se detiene y se reanuda luego. */
const MAX_PROVIDER_WAIT_MS = 5 * 60_000;

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

export type RestConversation = {
  id: string;
  participantId: string | null;
  participantName: string | null;
  /** Grupo de WhatsApp: no tiene un teléfono de cliente (no se importa, se reporta). Zernio hoy NO lo manda (N2, 26-sep). */
  isGroup?: boolean;
  /** Última actividad (Zernio `updatedTime`): la muestra toma los chats más recientes. */
  updatedTime?: string | null;
};
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

/** Teléfono tal como lo da Zernio (participantId/senderId) → "+dígitos", o null si no parece teléfono. */
export function restPhone(value: string | null | undefined): string | null {
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
  // Meta solo copia la media reciente (~14 días): un adjunto sin URL se conserva
  // como "no disponible" (tipo y nombre) en vez de perder qué había.
  const attachments: NormalizedAttachment[] = (m.attachments ?? []).map((a) => ({
    type: attachmentType(a.type),
    url: a.url ?? "",
    mimeType: a.mimeType ?? undefined,
    fileName: a.filename ?? undefined,
    providerMediaId: a.id ?? undefined,
    ...(a.url ? {} : { unavailable: "El historial del celular no trae este archivo (Meta solo copia la media reciente)" }),
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
      contactPhone: restPhone(conversation.participantId) ?? (outgoing ? null : restPhone(m.senderId)),
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

/** Error de lectura de Zernio. `retryable`: se puede reanudar más tarde con el mismo comando. */
export class ZernioHistoryError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export type ZernioHistoryPacing = {
  /** Espera mínima entre peticiones (ms). */
  minIntervalMs?: number;
  /** Peticiones del minuto que se dejan al CRM en vivo: con menos, se espera a que se libere la ventana. */
  reserve?: number;
  /** Intentos ante red caída, timeout o 5xx (con espera creciente) antes de rendirse. */
  maxAttempts?: number;
  /** 429 seguidos antes de rendirse (cada uno espera lo que diga Retry-After). */
  maxThrottled?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Aviso de cada espera larga (reintento, límite): el script lo muestra. */
  onWait?: (ms: number, reason: string) => void;
};

export type ZernioHistoryStats = { requests: number; retries: number; throttled: number; waitedMs: number };

type Page = { list: unknown[]; nextCursor: string | undefined; hasMore: boolean | undefined; raw: Record<string, unknown> };

function header(res: Response, name: string): number | null {
  const value = Number(res.headers.get(name));
  return res.headers.has(name) && Number.isFinite(value) ? value : null;
}

/** X-RateLimit-Reset: timestamp Unix (segundos o milisegundos) → ms. */
function resetAtMs(value: number | null): number | null {
  if (value === null || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

function pageOf(json: Record<string, unknown>, keys: string[]): Page | null {
  const key = keys.find((k) => Array.isArray(json[k]));
  if (!key) return null;
  const pagination = (json.pagination ?? {}) as Record<string, unknown>;
  return {
    list: json[key] as unknown[],
    nextCursor: typeof pagination.nextCursor === "string" && pagination.nextCursor ? pagination.nextCursor : undefined,
    hasMore: typeof pagination.hasMore === "boolean" ? pagination.hasMore : undefined,
    raw: json,
  };
}

/** Lecturas GET de la API de Zernio para el historial. Nunca imprime la API key. */
export class ZernioHistoryClient {
  readonly stats: ZernioHistoryStats = { requests: 0, retries: 0, throttled: 0, waitedMs: 0 };
  private minIntervalMs: number;
  private readonly reserve: number;
  private readonly maxAttempts: number;
  private readonly maxThrottled: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private remaining: number | null = null;
  private resetAt: number | null = null;

  constructor(
    private readonly config: { apiKey: string; baseUrl?: string; pacing?: ZernioHistoryPacing },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const p = config.pacing ?? {};
    this.minIntervalMs = p.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.reserve = p.reserve ?? DEFAULT_RATE_RESERVE;
    this.maxAttempts = p.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.maxThrottled = p.maxThrottled ?? DEFAULT_MAX_THROTTLED;
    this.sleep = p.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = p.now ?? Date.now;
  }

  /** Peticiones por minuto a las que va hoy. */
  get perMinute(): number {
    return this.minIntervalMs > 0 ? Math.round(60_000 / this.minIntervalMs) : Infinity;
  }

  /**
   * Baja el ritmo a la mitad (hasta 10/min): el CRM en vivo recibió un 429 de Zernio.
   * Devuelve las peticiones por minuto nuevas.
   */
  slowDown(): number {
    this.minIntervalMs = Math.min(6_000, Math.max(this.minIntervalMs * 2, 1_000));
    return this.perMinute;
  }

  private async wait(ms: number, reason: string): Promise<void> {
    if (ms <= 0) return;
    this.stats.waitedMs += ms;
    if (ms >= 5_000) this.config.pacing?.onWait?.(ms, reason);
    await this.sleep(ms);
  }

  /** Ritmo propio + reserva para el CRM: espera antes de cada petición. */
  private async pace(): Promise<void> {
    const now = this.now();
    let until = this.lastRequestAt + this.minIntervalMs;
    let reason = "ritmo";
    if (this.remaining !== null && this.remaining <= this.reserve && this.resetAt !== null && this.resetAt > now) {
      until = Math.max(until, Math.min(this.resetAt + 250, now + MAX_PROVIDER_WAIT_MS));
      reason = `límite de Zernio (quedan ${this.remaining} peticiones en la ventana; se dejan para el CRM)`;
      this.remaining = null; // tras la espera, la siguiente respuesta dice cuántas quedan
    }
    await this.wait(until - now, reason);
    this.lastRequestAt = this.now();
  }

  private backoffMs(attempt: number): number {
    return Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** (attempt - 1));
  }

  /**
   * GET con reintentos. `validate` devuelve un motivo si la respuesta 200 llegó
   * INCOMPLETA (p. ej. la cuenta falló del lado de Zernio): se reintenta igual que un 5xx.
   */
  private async get(path: string, validate?: (json: Record<string, unknown>) => string | null): Promise<Record<string, unknown>> {
    const url = `${(this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}${path}`;
    const label = path.split("?")[0];
    let attempt = 0;
    let throttled = 0;
    for (;;) {
      await this.pace();
      this.stats.requests++;
      let failure: string;
      try {
        const res = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const remaining = header(res, "x-ratelimit-remaining");
        if (remaining !== null) this.remaining = remaining;
        const reset = resetAtMs(header(res, "x-ratelimit-reset"));
        if (reset !== null) this.resetAt = reset;
        const json: unknown = await res.json().catch(() => null);
        if (res.status === 429) {
          throttled++;
          this.stats.throttled++;
          if (throttled > this.maxThrottled) {
            throw new ZernioHistoryError(`Zernio sigue limitando (429) en ${label} tras ${throttled} esperas`, true);
          }
          const details = (json && typeof json === "object" ? (json as Record<string, unknown>).details : null) as Record<string, unknown> | null;
          const seconds = header(res, "retry-after") ?? (typeof details?.retryAfterSeconds === "number" ? details.retryAfterSeconds : null);
          const waitMs = seconds !== null ? seconds * 1000 + 250 : this.backoffMs(throttled);
          if (waitMs > MAX_PROVIDER_WAIT_MS) {
            throw new ZernioHistoryError(`Zernio pide esperar ${Math.round(waitMs / 60_000)} min (429) en ${label}: se detiene`, true);
          }
          await this.wait(waitMs, `Zernio pidió esperar (429) en ${label}`);
          continue;
        }
        if (res.status >= 500 || res.status === 408) {
          failure = `Zernio respondió ${res.status} en ${label}`;
        } else if (!res.ok || !json || typeof json !== "object") {
          // 400/401/403/404: repetir no lo arregla.
          throw new ZernioHistoryError(`Zernio respondió ${res.status} en ${label}`);
        } else {
          const incomplete = validate?.(json as Record<string, unknown>) ?? null;
          if (!incomplete) return json as Record<string, unknown>;
          failure = `${incomplete} (${label})`;
        }
      } catch (error) {
        if (error instanceof ZernioHistoryError) throw error;
        failure = `Sin respuesta de Zernio (${label}): ${error instanceof Error ? error.message : String(error)}`;
      }
      attempt++;
      if (attempt >= this.maxAttempts) throw new ZernioHistoryError(`${failure}; ${attempt} intentos`, true);
      this.stats.retries++;
      await this.wait(this.backoffMs(attempt), `${failure}; reintento ${attempt} de ${this.maxAttempts - 1}`);
    }
  }

  /** Recorre TODAS las páginas por cursor; nunca se salta una (cursor repetido o perdido = error). */
  private async *pages(
    what: string,
    path: (cursor: string | undefined) => string,
    keys: string[],
    maxPages: number,
    validate?: (json: Record<string, unknown>) => string | null,
  ): AsyncGenerator<Page> {
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const json = await this.get(path(cursor), validate);
      const parsed = pageOf(json, keys);
      if (!parsed) throw new ZernioHistoryError(`Listado de ${what} con formato no reconocido`);
      yield parsed;
      if (parsed.hasMore === false) return;
      if (!parsed.nextCursor) {
        if (parsed.hasMore === true) throw new ZernioHistoryError(`Zernio dice que hay más ${what} pero no dio cursor: se detiene para no saltarse páginas`, true);
        return;
      }
      if (seen.has(parsed.nextCursor)) throw new ZernioHistoryError(`Zernio repitió un cursor de ${what}: se detiene para no ciclar`, true);
      seen.add(parsed.nextCursor);
      cursor = parsed.nextCursor;
    }
    throw new ZernioHistoryError(`Más de ${maxPages} páginas de ${what}: se detiene (revisar)`);
  }

  /**
   * Conversaciones de WhatsApp de la cuenta: activas y archivadas, en orden
   * ascendente de actualización, sin repetir ninguna.
   */
  async *conversations(accountId: string): AsyncGenerator<RestConversation> {
    const yielded = new Set<string>();
    const partial = (json: Record<string, unknown>): string | null => {
      const meta = (json.meta ?? {}) as Record<string, unknown>;
      const failed = Array.isArray(meta.failedAccounts) ? meta.failedAccounts : [];
      if ((typeof meta.accountsFailed === "number" && meta.accountsFailed > 0) || failed.length > 0) {
        return "Zernio devolvió el listado incompleto (la cuenta falló de su lado)";
      }
      return null;
    };
    for (const status of [null, "archived"] as const) {
      const path = (cursor: string | undefined) => {
        const params = new URLSearchParams({ accountId, platform: "whatsapp", limit: "100", sortOrder: "asc" });
        if (status) params.set("status", status);
        if (cursor) params.set("cursor", cursor);
        return `/v1/inbox/conversations?${params.toString()}`;
      };
      for await (const page of this.pages("conversaciones", path, ["data", "conversations"], MAX_CONVERSATION_PAGES, partial)) {
        for (const raw of page.list as Record<string, unknown>[]) {
          if (!raw || typeof raw.id !== "string" || !raw.id || yielded.has(raw.id)) continue;
          if (raw.accountId && raw.accountId !== accountId) continue;
          if (raw.platform && raw.platform !== "whatsapp") continue;
          yielded.add(raw.id);
          yield {
            id: raw.id,
            participantId: typeof raw.participantId === "string" ? raw.participantId : null,
            participantName: typeof raw.participantName === "string" ? raw.participantName : null,
            isGroup: raw.isGroup === true,
            updatedTime: typeof raw.updatedTime === "string" ? raw.updatedTime : null,
          };
        }
      }
    }
  }

  /** Mensajes de una conversación por páginas (≤100), del más viejo al más nuevo. */
  async *messagePages(accountId: string, conversationId: string): AsyncGenerator<unknown[]> {
    const path = (cursor: string | undefined) => {
      const params = new URLSearchParams({ accountId, limit: "100", sortOrder: "asc" });
      if (cursor) params.set("cursor", cursor);
      return `/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`;
    };
    for await (const page of this.pages(`mensajes de ${conversationId}`, path, ["messages", "data"], MAX_MESSAGE_PAGES)) {
      yield page.list;
    }
  }

  /** Mensajes de una conversación, uno por uno (del más viejo al más nuevo). */
  async *messages(accountId: string, conversationId: string): AsyncGenerator<unknown> {
    for await (const page of this.messagePages(accountId, conversationId)) yield* page;
  }

  /** Agenda de la app (contactos que Zernio importó): nombre + teléfono E.164, sin repetir teléfono. */
  async *contacts(accountId: string): AsyncGenerator<{ phoneE164: string; name: string }> {
    const limit = 200;
    const seen = new Set<string>();
    for (let page = 0; page < MAX_CONTACT_PAGES; page++) {
      const params = new URLSearchParams({ accountId, platform: "whatsapp", limit: String(limit), skip: String(page * limit) });
      const json = await this.get(`/v1/contacts?${params.toString()}`);
      const list = Array.isArray(json.contacts) ? json.contacts : Array.isArray(json.data) ? json.data : null;
      if (!list) throw new ZernioHistoryError("Listado de contactos con formato no reconocido");
      for (const raw of list as Record<string, unknown>[]) {
        const name = typeof raw.name === "string" ? raw.name : "";
        const id = typeof raw.platformIdentifier === "string" ? raw.platformIdentifier : typeof raw.displayIdentifier === "string" ? raw.displayIdentifier : "";
        const phone = restPhone(id);
        if (!name || !phone) continue;
        let phoneE164: string;
        try {
          phoneE164 = normalizePhone(phone);
        } catch {
          continue; // teléfono que no es E.164 válido: se omite
        }
        if (seen.has(phoneE164)) continue;
        seen.add(phoneE164);
        yield { phoneE164, name };
      }
      const pagination = (json.pagination ?? {}) as Record<string, unknown>;
      if (pagination.hasMore !== true || list.length === 0) return;
    }
    throw new ZernioHistoryError(`Más de ${MAX_CONTACT_PAGES} páginas de contactos: se detiene (revisar)`);
  }
}
