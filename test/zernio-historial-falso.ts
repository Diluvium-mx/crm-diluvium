// Zernio FALSO para probar el importador del historial sin tocar la API real.
// Responde con la forma documentada (docs.zernio.com: List conversations, List
// messages, List contacts) y la VERIFICADA con N2 en producción (26-sep-2026, solo GET):
// cursores `updatedTime_cuenta_id` (conversaciones) y `db:<fecha>_<id>` (mensajes),
// SIN campo isGroup (Zernio no lo manda: un grupo solo se reconoce por su participante),
// `senderPhoneNumber` en cada mensaje y createdAt = sentAt (hora original de WhatsApp):
// - GET /v1/inbox/conversations  → { data[], pagination{hasMore,nextCursor}, meta{accountsFailed,…} }
//   orden por updatedTime (asc/desc), filtro status (sin status = activas; archived = archivadas)
// - GET /v1/inbox/conversations/{id}/messages → { status, pagination, sortOrderApplied, messages[], lastUpdated }
//   mensajes con id = wamid, metadata.source "coexistence_history", attachments{id,type,url,mimeType,filename}
// - GET /v1/contacts → { success, contacts[], pagination{total,limit,skip,hasMore} }
// Puede inyectar 429 (con Retry-After), 5xx y listados incompletos para ejercitar reintentos.

export type FakeAttachment = { id: string; type: "image" | "video" | "audio" | "file" | "sticker"; url: string | null; mimeType: string; filename?: string };

export type FakeMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  message: string | null;
  sentAt: string;
  attachments: FakeAttachment[];
  /** false = mensaje vivo (llegó por webhook): el importador lo salta. */
  history?: boolean;
  /** Remitente de un entrante (grupos); por omisión, el participante del chat. */
  senderId?: string;
};

export type FakeChat = {
  id: string;
  participantId: string | null;
  participantName: string | null;
  archived?: boolean;
  messages: FakeMessage[];
};

export type FakeWorld = {
  accountId: string;
  chats: FakeChat[];
  contacts: { name: string; platformIdentifier: string }[];
};

export type FakeZernioOptions = {
  /** Cada N peticiones, un 429 con Retry-After: 1. */
  throttleEvery?: number;
  /** Cada N peticiones, un 502. */
  failEvery?: number;
  /** Encabezados de límite que se devuelven (X-RateLimit-Remaining baja y se reinicia). */
  rateLimit?: { limit: number; windowMs: number; now: () => number };
  onRequest?: (url: URL) => void;
};

/** Cursor con la forma real; la página siguiente empieza DESPUÉS del elemento que nombra. */
function after<T>(list: readonly T[], cursor: string | null, keyOf: (item: T) => string): number {
  if (!cursor) return 0;
  const i = list.findIndex((item) => keyOf(item) === cursor);
  if (i === -1) throw new Error(`cursor desconocido: ${cursor}`);
  return i + 1;
}

function updatedTime(chat: FakeChat): string {
  return chat.messages.reduce((max, m) => (m.sentAt > max ? m.sentAt : max), "1970-01-01T00:00:00.000Z");
}

function restMessage(world: FakeWorld, chat: FakeChat, m: FakeMessage) {
  const outgoing = m.direction === "outgoing";
  return {
    id: m.id,
    conversationId: chat.id,
    accountId: world.accountId,
    platform: "whatsapp",
    message: m.message,
    senderId: outgoing ? world.accountId : (m.senderId ?? chat.participantId),
    senderName: outgoing ? "Diluvium" : chat.participantName,
    senderPhoneNumber: outgoing ? "+5216682419579" : `+${(m.senderId ?? chat.participantId ?? "").replace(/\D/g, "")}`,
    direction: m.direction,
    createdAt: m.sentAt,
    sentAt: m.sentAt,
    attachments: m.attachments,
    isEdited: false,
    isDeleted: false,
    deliveryStatus: outgoing ? "read" : null,
    reactions: [],
    metadata: m.history === false ? { source: "whatsapp_business_app" } : { source: "coexistence_history" },
    sentVia: null,
  };
}

/** fetch falso: resuelve las rutas de Zernio contra el mundo dado. */
export function fakeZernioFetch(world: FakeWorld, opts: FakeZernioOptions = {}): typeof fetch & { calls: number } {
  let calls = 0;
  let windowStart = opts.rateLimit?.now() ?? 0;
  let used = 0;
  const byId = new Map(world.chats.map((c) => [c.id, c]));

  const handler = async (input: string | URL | Request): Promise<Response> => {
    calls++;
    handler.calls = calls;
    const url = new URL(String(input instanceof Request ? input.url : input));
    opts.onRequest?.(url);
    const headers: Record<string, string> = {};
    if (opts.rateLimit) {
      const now = opts.rateLimit.now();
      if (now - windowStart >= opts.rateLimit.windowMs) {
        windowStart = now;
        used = 0;
      }
      used++;
      headers["X-RateLimit-Limit"] = String(opts.rateLimit.limit);
      headers["X-RateLimit-Remaining"] = String(Math.max(0, opts.rateLimit.limit - used));
      headers["X-RateLimit-Reset"] = String(Math.ceil((windowStart + opts.rateLimit.windowMs) / 1000));
    }
    if (opts.throttleEvery && calls % opts.throttleEvery === 0) {
      return Response.json({ error: "Rate limit exceeded. Please retry after 1 seconds.", details: { retryAfterSeconds: 1 } }, { status: 429, headers: { ...headers, "Retry-After": "1" } });
    }
    if (opts.failEvery && calls % opts.failEvery === 0) return new Response("bad gateway", { status: 502 });

    const path = url.pathname.replace(/^\/api/, "");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    if (url.searchParams.get("accountId") !== world.accountId) return Response.json({ error: "cuenta" }, { status: 404 });

    if (path === "/v1/inbox/conversations") {
      const status = url.searchParams.get("status");
      const asc = url.searchParams.get("sortOrder") === "asc";
      const list = world.chats
        .filter((c) => (status === "archived" ? c.archived === true : c.archived !== true))
        .map((c) => ({ c, t: updatedTime(c) }))
        .sort((a, b) => (asc ? a.t.localeCompare(b.t) : b.t.localeCompare(a.t)) || a.c.id.localeCompare(b.c.id));
      const convKey = ({ c, t }: { c: FakeChat; t: string }) => `${t}_${world.accountId}_${c.id}`;
      const offset = after(list, url.searchParams.get("cursor"), convKey);
      const page = list.slice(offset, offset + limit);
      const hasMore = offset + limit < list.length;
      return Response.json(
        {
          data: page.map(({ c, t }) => ({
            id: c.id,
            platform: "whatsapp",
            accountId: world.accountId,
            accountUsername: "+52 1 668 241 9579",
            participantId: c.participantId,
            participantName: c.participantName,
            participantPicture: null,
            lastMessage: c.messages.at(-1)?.message ?? "",
            updatedTime: t,
            participantUsername: c.participantId,
            status: c.archived ? "archived" : "active",
            unreadCount: 0,
            contactBlocked: false,
            url: null,
          })),
          pagination: { hasMore, nextCursor: hasMore ? convKey(page[page.length - 1]) : null },
          meta: { accountsQueried: 1, accountsFailed: 0, failedAccounts: [], lastUpdated: new Date().toISOString(), accountsSkipped: [] },
        },
        { headers },
      );
    }

    const messagesMatch = path.match(/^\/v1\/inbox\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const chat = byId.get(decodeURIComponent(messagesMatch[1]));
      if (!chat) return Response.json({ error: "no existe" }, { status: 404 });
      const asc = (url.searchParams.get("sortOrder") ?? "asc") === "asc";
      const list = [...chat.messages].sort((a, b) => (asc ? a.sentAt.localeCompare(b.sentAt) : b.sentAt.localeCompare(a.sentAt)));
      const msgKey = (m: FakeMessage) => `db:${m.sentAt}_${m.id}`;
      const offset = after(list, url.searchParams.get("cursor"), msgKey);
      const page = list.slice(offset, offset + Math.min(limit, 100));
      const hasMore = offset + limit < list.length;
      return Response.json(
        {
          status: "success",
          pagination: { hasMore, nextCursor: hasMore ? msgKey(page[page.length - 1]) : null },
          sortOrderApplied: asc ? "asc" : "desc",
          messages: page.map((m) => restMessage(world, chat, m)),
          lastUpdated: new Date().toISOString(),
        },
        { headers },
      );
    }

    if (path === "/v1/contacts") {
      const skip = Number(url.searchParams.get("skip") ?? "0");
      const page = world.contacts.slice(skip, skip + Math.min(limit, 200));
      return Response.json(
        {
          success: true,
          contacts: page.map((c, i) => ({ id: `zc_${skip + i}`, name: c.name, platform: "whatsapp", platformIdentifier: c.platformIdentifier, displayIdentifier: c.platformIdentifier })),
          filters: { tags: [] },
          pagination: { total: world.contacts.length, limit, skip, hasMore: skip + limit < world.contacts.length },
        },
        { headers },
      );
    }
    return Response.json({ error: `ruta desconocida ${path}` }, { status: 404 });
  };
  handler.calls = 0;
  return handler as unknown as typeof fetch & { calls: number };
}
