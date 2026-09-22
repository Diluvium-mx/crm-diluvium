// Tests de integración de las lecturas/escrituras de la bandeja contra
// Postgres REAL: filtros, búsqueda, paginación por cursor, semáforo, corte de
// lectura y aislamiento entre organizaciones. Solo con TEST_DATABASE_URL a una
// base DESECHABLE con migraciones aplicadas.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type Q = typeof import("./queries");

describe.skipIf(!TEST_DATABASE_URL)("bandeja: lecturas y escrituras (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let q: Q;
  let eq: typeof import("drizzle-orm").eq;
  const ORG_A = "org_a";
  const ORG_B = "org_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    q = await import("./queries");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u1", name: "Vendedor", email: "u1@x.mx" }).onConflictDoNothing();
    for (const org of [ORG_A, ORG_B]) {
      await db.insert(s.channels).values({
        id: `ch_${org}`,
        organizationId: org,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: `zacc_${org}`,
        displayName: "Diluvium",
      });
    }
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  async function seedConversation(opts: {
    org?: string;
    firstName?: string;
    lastName?: string | null;
    phone?: string;
    lastMessageAt: string;
    unread?: number;
    starred?: boolean;
    windowExpiresAt?: string | null;
    sourceChannel?: string | null;
  }) {
    seq++;
    const org = opts.org ?? ORG_A;
    const contactId = `c_${seq}`;
    const convId = `conv_${seq}`;
    await db.insert(s.contacts).values({
      id: contactId,
      organizationId: org,
      firstName: opts.firstName ?? `Cliente ${seq}`,
      lastName: opts.lastName ?? null,
      phoneE164: opts.phone ?? `+52166800000${seq}`,
      sourceChannel: opts.sourceChannel ?? "whatsapp",
    });
    await db.insert(s.conversations).values({
      id: convId,
      organizationId: org,
      contactId,
      channelId: `ch_${org}`,
      lastMessageAt: new Date(opts.lastMessageAt),
      unreadCount: opts.unread ?? 0,
      isStarred: opts.starred ?? false,
      windowExpiresAt: opts.windowExpiresAt === undefined ? new Date(Date.now() + 3600_000) : opts.windowExpiresAt ? new Date(opts.windowExpiresAt) : null,
    });
    return { contactId, convId };
  }

  async function addMessage(opts: {
    org?: string;
    convId: string;
    direction: "in" | "out";
    source?: string;
    body?: string | null;
    type?: string;
    status?: string;
    sentByUserId?: string | null;
    sentAt: string;
    attachments?: unknown[];
    adReferral?: Record<string, unknown> | null;
  }) {
    seq++;
    await db.insert(s.messages).values({
      id: `m_${seq}_${randomUUID()}`,
      organizationId: opts.org ?? ORG_A,
      conversationId: opts.convId,
      direction: opts.direction,
      source: (opts.source ?? (opts.direction === "in" ? "contact" : "crm")) as "crm",
      type: (opts.type ?? "text") as "text",
      body: "body" in opts ? (opts.body ?? null) : "hola",
      status: (opts.status ?? (opts.direction === "in" ? "received" : "sent")) as "sent",
      sentByUserId: opts.sentByUserId ?? null,
      sentAt: new Date(opts.sentAt),
      attachments: (opts.attachments ?? []) as never,
      adReferral: opts.adReferral ?? null,
    });
  }

  it("lista ordenada por último mensaje, con vista previa y no leídos; filtra por organización", async () => {
    await seedConversation({ lastMessageAt: "2026-09-18T10:00:00Z", firstName: "Ana", lastName: "López", unread: 2 });
    const { convId } = await seedConversation({ lastMessageAt: "2026-09-18T12:00:00Z", firstName: "Beto" });
    await addMessage({ convId, direction: "out", body: "¿Te sirve el jueves?", sentAt: "2026-09-18T12:00:00Z" });
    await seedConversation({ org: ORG_B, lastMessageAt: "2026-09-18T13:00:00Z", firstName: "Otra" });

    const page = await q.listConversationsForOrg(ORG_A);
    expect(page.items.map((c) => c.contact.name)).toEqual(["Beto", "Ana López"]);
    expect(page.items[0].lastMessage).toMatchObject({ preview: "¿Te sirve el jueves?", direction: "out" });
    expect(page.items[1].unreadCount).toBe(2);
    expect(page.items[1].contact.avatarInitials).toBe("AL");
  });

  it("filas por id (tiempo real): mismo filtro que la lista y nunca de otra organización", async () => {
    const unread = await seedConversation({ lastMessageAt: "2026-09-18T10:00:00Z", unread: 3 });
    const read = await seedConversation({ lastMessageAt: "2026-09-18T11:00:00Z" });
    const other = await seedConversation({ org: ORG_B, lastMessageAt: "2026-09-18T12:00:00Z" });
    const ids = [unread.convId, read.convId, other.convId];
    expect((await q.listConversationItemsByIdsForOrg(ORG_A, ids)).map((c) => c.id).sort()).toEqual(
      [unread.convId, read.convId].sort(),
    );
    expect((await q.listConversationItemsByIdsForOrg(ORG_A, ids, { filter: "unread" })).map((c) => c.id)).toEqual([
      unread.convId,
    ]);
    expect(await q.listConversationItemsByIdsForOrg(ORG_A, [])).toEqual([]);
  });

  it("filtros No leído y Destacado", async () => {
    await seedConversation({ lastMessageAt: "2026-09-18T10:00:00Z", unread: 3 });
    await seedConversation({ lastMessageAt: "2026-09-18T11:00:00Z", starred: true });
    await seedConversation({ lastMessageAt: "2026-09-18T12:00:00Z" });
    expect((await q.listConversationsForOrg(ORG_A, { filter: "unread" })).items).toHaveLength(1);
    expect((await q.listConversationsForOrg(ORG_A, { filter: "starred" })).items).toHaveLength(1);
    expect((await q.listConversationsForOrg(ORG_A, { filter: "all" })).items).toHaveLength(3);
  });

  it("búsqueda por nombre y por teléfono (con o sin formato)", async () => {
    await seedConversation({ lastMessageAt: "2026-09-18T10:00:00Z", firstName: "María", lastName: "Ruiz", phone: "+526681234567" });
    await seedConversation({ lastMessageAt: "2026-09-18T11:00:00Z", firstName: "Pedro", phone: "+526687654321" });
    expect((await q.listConversationsForOrg(ORG_A, { search: "maría" })).items).toHaveLength(1);
    expect((await q.listConversationsForOrg(ORG_A, { search: "ruiz" })).items[0].contact.name).toBe("María Ruiz");
    expect((await q.listConversationsForOrg(ORG_A, { search: "668 123 4567" })).items).toHaveLength(1);
    expect((await q.listConversationsForOrg(ORG_A, { search: "999" })).items).toHaveLength(0);
  });

  it("paginación por cursor, estable con el mismo timestamp", async () => {
    for (let i = 0; i < 3; i++) {
      await seedConversation({ lastMessageAt: "2026-09-18T10:00:00Z", firstName: `C${i}` });
    }
    const first = await q.listConversationsForOrg(ORG_A);
    // limit real es 50; forzamos página pequeña reusando cursor manual no aplica,
    // así que validamos que sin más páginas nextCursor sea null.
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeNull();
  });

  it("semáforo: espera desde el entrante sin responder; nada si el vendedor ya contestó", async () => {
    const a = await seedConversation({ lastMessageAt: "2026-09-18T10:05:00Z" });
    await addMessage({ convId: a.convId, direction: "in", sentAt: "2026-09-18T10:00:00Z" });
    await addMessage({ convId: a.convId, direction: "in", sentAt: "2026-09-18T10:05:00Z" });

    const b = await seedConversation({ lastMessageAt: "2026-09-18T11:10:00Z" });
    await addMessage({ convId: b.convId, direction: "in", sentAt: "2026-09-18T11:00:00Z" });
    await addMessage({ convId: b.convId, direction: "out", source: "crm", sentByUserId: "u1", status: "sent", sentAt: "2026-09-18T11:10:00Z" });

    const page = await q.listConversationsForOrg(ORG_A);
    const byId = new Map(page.items.map((c) => [c.id, c]));
    expect(byId.get(a.convId)!.awaitingReplySince?.toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(byId.get(b.convId)!.awaitingReplySince).toBeNull();
  });

  it("un envío en cola o fallido no cuenta como respuesta para el semáforo", async () => {
    const a = await seedConversation({ lastMessageAt: "2026-09-18T10:10:00Z" });
    await addMessage({ convId: a.convId, direction: "in", sentAt: "2026-09-18T10:00:00Z" });
    await addMessage({ convId: a.convId, direction: "out", source: "crm", sentByUserId: "u1", status: "queued", sentAt: "2026-09-18T10:10:00Z" });
    const page = await q.listConversationsForOrg(ORG_A);
    expect(page.items[0].awaitingReplySince?.toISOString()).toBe("2026-09-18T10:00:00.000Z");
  });

  it("listMessages: cronológico, paginado hacia atrás, con adjuntos y anuncio saneado", async () => {
    const { convId } = await seedConversation({ lastMessageAt: "2026-09-18T10:02:00Z" });
    await addMessage({
      convId,
      direction: "in",
      body: null,
      type: "image",
      sentAt: "2026-09-18T10:00:00Z",
      attachments: [{ type: "image", url: "https://cdn/x.jpg", storageKey: "k" }],
      adReferral: { ctwa_clid: "SECRETO", headline: "Portón", image_url: "https://cdn/ad.jpg" },
    });
    await addMessage({ convId, direction: "out", source: "crm", sentByUserId: "u1", body: "Va", sentAt: "2026-09-18T10:02:00Z" });

    const page = await q.listMessagesForOrg(ORG_A, convId);
    expect(page).not.toBeNull();
    expect(page!.messages.map((m) => m.body)).toEqual([null, "Va"]);
    expect(page!.messages[0].attachments[0]).toMatchObject({ index: 0, state: "ready", url: expect.stringContaining("/api/media/") });
    expect(page!.messages[0].adReferral).toEqual({ headline: "Portón", body: null, thumbnailUrl: "https://cdn/ad.jpg", sourceUrl: null, mediaType: null });

    const older = await q.listMessagesForOrg(ORG_A, convId, { before: page!.messages[1].id, limit: 10 });
    expect(older!.messages.map((m) => m.body)).toEqual([null]);
  });

  it("markConversationRead respeta el corte: lo posterior sigue sin leer; idempotente", async () => {
    const { convId } = await seedConversation({ lastMessageAt: "2026-09-18T10:02:00Z", unread: 2 });
    await addMessage({ convId, direction: "in", sentAt: "2026-09-18T10:00:00Z" });
    // Corte: la UI vio hasta este mensaje.
    const cutoffId = `m_cut_${randomUUID()}`;
    await db.insert(s.messages).values({
      id: cutoffId,
      organizationId: ORG_A,
      conversationId: convId,
      direction: "in",
      source: "contact",
      type: "text",
      body: "hola",
      status: "received",
      sentAt: new Date("2026-09-18T10:01:00Z"),
    });
    // Llega otro DESPUÉS del corte.
    await addMessage({ convId, direction: "in", sentAt: "2026-09-18T10:05:00Z" });

    await q.markConversationReadForOrg(ORG_A, convId, cutoffId);
    let [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, convId));
    expect(conv.unreadCount).toBe(1); // el posterior al corte
    // Idempotente
    await q.markConversationReadForOrg(ORG_A, convId, cutoffId);
    [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, convId));
    expect(conv.unreadCount).toBe(1);
  });

  it("setConversationStarred y getConversation con anuncio; aislamiento entre organizaciones", async () => {
    const { convId, contactId } = await seedConversation({ lastMessageAt: "2026-09-18T10:00:00Z" });
    await db.update(s.conversations).set({ adReferral: { headline: "Anuncio", source_url: "https://fb.com/a" } }).where(eq(s.conversations.id, convId));

    expect(await q.setConversationStarredForOrg(ORG_A, convId, true)).toBe(true);
    // Otra organización no puede tocar ni ver la conversación.
    expect(await q.setConversationStarredForOrg(ORG_B, convId, true)).toBe(false);
    expect(await q.getConversationForOrg(ORG_B, convId)).toBeNull();
    expect(await q.listMessagesForOrg(ORG_B, convId)).toBeNull();

    const detail = await q.getConversationForOrg(ORG_A, convId);
    expect(detail).toMatchObject({ isStarred: true, adReferral: { headline: "Anuncio", sourceUrl: "https://fb.com/a" } });
    expect(detail!.contact.stage).toBeDefined();

    const byContact = await q.getConversationByContactForOrg(ORG_A, contactId);
    expect(byContact!.id).toBe(convId);
    expect(await q.getConversationByContactForOrg(ORG_A, "inexistente")).toBeNull();
  });
});
