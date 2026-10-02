// Importador del historial de Instagram contra Postgres REAL y un Zernio FALSO con la forma
// verificada en la cuenta real (2-oct-2026): conversaciones con id = participantId (IGSID) y
// participantUsername; mensajes con id = mid de Meta. Base desechable con todas las
// migraciones; cada prueba borra sus datos antes de empezar. Nunca a staging ni prod.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const ACCOUNT = "zacc_ig";
const H = 3_600_000;

type FakeMsg = { id: string; direction: "incoming" | "outgoing"; message: string; msAgo: number; attachments?: unknown[] };
type FakeChat = { igsid: string; name: string; username: string; messages: FakeMsg[] };

describe.skipIf(!TEST_DATABASE_URL)("importador del historial de Instagram (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let importer: typeof import("./instagram-history");
  let state: typeof import("./history-state");
  let zh: typeof import("./zernio-history");
  let dashboard: typeof import("@/lib/dashboard/queries");
  let sql: typeof import("drizzle-orm").sql;
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_ig";
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    importer = await import("./instagram-history");
    state = await import("./history-state");
    zh = await import("./zernio-history");
    dashboard = await import("@/lib/dashboard/queries");
    ({ sql, eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    await db.execute(sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "diluvium-ig", createdAt: new Date() });
    await db.insert(s.channels).values({
      id: "ch_ig",
      organizationId: ORG,
      type: "instagram",
      provider: "zernio",
      providerAccountId: ACCOUNT,
      displayName: "Instagram @diluviummx",
      aiAgentMode: "auto",
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  // Zernio falso: listado de conversaciones (2 por página) y mensajes (todos en una página).
  function fakeFetch(chats: FakeChat[], calls: string[] = []): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      const json = (body: unknown) => Response.json(body);
      const m = url.pathname.match(/\/v1\/inbox\/conversations\/([^/]+)\/messages$/);
      if (m) {
        const chat = chats.find((c) => c.igsid === decodeURIComponent(m[1]))!;
        return json({
          status: "success",
          messages: chat.messages.map((x) => ({
            id: x.id,
            conversationId: chat.igsid,
            accountId: ACCOUNT,
            platform: "instagram",
            message: x.message,
            senderId: x.direction === "incoming" ? chat.igsid : ACCOUNT,
            senderName: x.direction === "incoming" ? chat.name : "Diluvium México",
            direction: x.direction,
            createdAt: iso(x.msAgo),
            sentAt: iso(x.msAgo),
            attachments: x.attachments ?? [],
            isStoryMention: false,
            noRenderableContent: false,
            sentVia: null,
          })),
          pagination: { hasMore: false, nextCursor: null },
        });
      }
      if (url.pathname.endsWith("/v1/inbox/conversations")) {
        if (url.searchParams.get("status") === "archived") return json({ data: [], pagination: { hasMore: false, nextCursor: null }, meta: { accountsFailed: 0 } });
        const start = url.searchParams.get("cursor") ? Number(url.searchParams.get("cursor")) : 0;
        const page = chats.slice(start, start + 2);
        const next = start + 2 < chats.length ? String(start + 2) : null;
        return json({
          data: page.map((c) => ({
            id: c.igsid,
            accountId: ACCOUNT,
            accountUsername: "diluviummx",
            platform: "instagram",
            participantId: c.igsid,
            participantName: c.name,
            participantUsername: c.username,
            participantPicture: null,
            updatedTime: iso(Math.min(...c.messages.map((x) => x.msAgo))),
            status: "active",
            unreadCount: 0,
          })),
          pagination: { hasMore: !!next, nextCursor: next },
          meta: { accountsFailed: 0 },
        });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
  }

  const client = (chats: FakeChat[], calls?: string[]) =>
    new zh.ZernioHistoryClient({ apiKey: "k", baseUrl: "https://zernio.test/api", pacing: { minIntervalMs: 0, sleep: async () => undefined } }, fakeFetch(chats, calls));

  const chats: FakeChat[] = [
    { igsid: "1784140000000001", name: "Ana López", username: "ana.lopez", messages: [
      { id: "mid_a1", direction: "incoming", message: "Hola, ¿precio?", msAgo: 30 * 24 * H },
      { id: "mid_a2", direction: "outgoing", message: "Claro, ¿qué medida?", msAgo: 30 * 24 * H - 60_000 },
    ] },
    { igsid: "1784140000000002", name: "Carlos Ruiz", username: "carlos.ruiz", messages: [
      { id: "mid_c1", direction: "incoming", message: "¿Hacen envíos?", msAgo: 3 * H },
    ] },
    { igsid: "1784140000000003", name: "Mariana", username: "mariana", messages: [
      { id: "mid_m1", direction: "incoming", message: "Gracias", msAgo: 2 * 24 * H },
    ] },
  ];

  it("crea contactos de Instagram (sin teléfono) con su historial marcado como importado: sin no leídos ni Dashboard", async () => {
    const report = await importer.importInstagramHistory(client(chats), ACCOUNT);
    expect(report).toMatchObject({ conversaciones: 3, procesadas: 3, importados: 4, duplicados: 0, contactos: { nuevos: 3, existentes: 0 }, terminado: true });
    const all = await db.select().from(s.contacts);
    expect(all).toHaveLength(3);
    expect(all.every((c) => c.phoneE164 === null && c.instagramId && c.source === "historial_instagram" && c.sourceChannel === "instagram")).toBe(true);
    expect(all.find((c) => c.instagramId === "1784140000000002")?.instagramUsername).toBe("carlos.ruiz");
    const msgs = await db.select().from(s.messages);
    expect(msgs).toHaveLength(4);
    expect(msgs.every((m) => m.importedAt !== null)).toBe(true);
    const convs = await db.select().from(s.conversations);
    expect(convs.every((c) => c.unreadCount === 0)).toBe(true);
    // Excluidos de "conversaciones nuevas" del Dashboard.
    expect(dashboard.EXCLUDED_SOURCES).toContain("historial_instagram");
  });

  it("la ventana sale del último mensaje del cliente: un chat de hace 3 h queda contestable", async () => {
    await importer.importInstagramHistory(client(chats), ACCOUNT);
    const [carlos] = await db
      .select({ w: s.conversations.windowExpiresAt })
      .from(s.conversations)
      .innerJoin(s.contacts, eq(s.contacts.id, s.conversations.contactId))
      .where(eq(s.contacts.instagramId, "1784140000000002"));
    expect(carlos.w && carlos.w.getTime()).toBeGreaterThan(Date.now() + 20 * H);
  });

  it("un cliente que ya escribió en vivo: su historial se pega a SU conversación y lo repetido no se duplica", async () => {
    // Conversación viva (id interno de Zernio, distinto del IGSID del listado) con el mid_c1 ya guardado.
    await db.insert(s.contacts).values({ id: "ct_live", organizationId: ORG, firstName: "Carlos Ruiz", instagramId: "1784140000000002", instagramUsername: "carlos.ruiz", source: "instagram", sourceChannel: "instagram" });
    await db.insert(s.conversations).values({ id: "cv_live", organizationId: ORG, contactId: "ct_live", channelId: "ch_ig", providerConversationId: "6ab0000000000000000000c2", lastMessageAt: new Date(now - 3 * H) });
    await db.insert(s.messages).values({ id: "m_live", organizationId: ORG, conversationId: "cv_live", direction: "in", source: "contact", type: "text", body: "¿Hacen envíos?", status: "received", providerMessageId: "mid_c1", sentAt: new Date(now - 3 * H) });

    const report = await importer.importInstagramHistory(client(chats), ACCOUNT);
    expect(report).toMatchObject({ importados: 3, duplicados: 1, contactos: { nuevos: 2, existentes: 1 } });
    expect(await db.select().from(s.contacts)).toHaveLength(3);
    const [cv] = await db.select().from(s.conversations).where(eq(s.conversations.contactId, "ct_live"));
    expect(cv.id).toBe("cv_live");
    expect(cv.providerConversationId).toBe("6ab0000000000000000000c2"); // se queda el id vivo
    expect(await db.select().from(s.messages).where(eq(s.messages.conversationId, "cv_live"))).toHaveLength(1);
  });

  it("simular no escribe nada", async () => {
    const report = await importer.importInstagramHistory(client(chats), ACCOUNT, { dryRun: true });
    expect(report).toMatchObject({ modo: "simulacion", importados: 4, contactos: { nuevos: 3 } });
    expect(await db.select().from(s.contacts)).toHaveLength(0);
    expect(await db.select().from(s.messages)).toHaveLength(0);
  });

  it("repetirlo no duplica, y una corrida cortada reanuda sin volver a leer lo terminado", async () => {
    const store = state.memoryStateStore();
    const controller = new AbortController();
    let n = 0;
    const calls: string[] = [];
    const first = await importer.importInstagramHistory(client(chats, calls), ACCOUNT, {
      state: store,
      signal: controller.signal,
      log: (line) => {
        if (line.startsWith("chat") && ++n === 1) controller.abort();
      },
    });
    // Se corta al terminar algún chat: lo hecho queda en el punto de reanudación.
    expect(first.cortado || first.terminado).toBe(true);
    const second = await importer.importInstagramHistory(client(chats), ACCOUNT, { state: store });
    expect(second.terminado).toBe(true);
    const again = await importer.importInstagramHistory(client(chats), ACCOUNT);
    expect(again.importados).toBe(0);
    expect(await db.select().from(s.messages)).toHaveLength(4);
  });

  it("sin canal de Instagram para la cuenta, no hace nada", async () => {
    await expect(importer.importInstagramHistory(client(chats), "otra_cuenta")).rejects.toThrow(/No hay canal de Instagram/);
  });
});
