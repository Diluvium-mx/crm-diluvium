// Búsqueda DENTRO de los chats (lupa amarilla) contra Postgres REAL: la lista de la
// Bandeja, los contactos del Embudo, la barra «1 de N» del chat y que la consulta use el
// índice de la 0050. Solo con TEST_DATABASE_URL a una base DESECHABLE con migraciones.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("búsqueda en los chats (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let q: typeof import("./queries");
  let cs: typeof import("./chat-search");
  const ORG_A = "org_a";
  const ORG_B = "org_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    q = await import("./queries");
    cs = await import("./chat-search");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
    ]);
    for (const [id, org] of [
      ["ch_a", ORG_A],
      ["ch_a2", ORG_A],
      ["ch_b", ORG_B],
    ] as const) {
      await db.insert(s.channels).values({
        id,
        organizationId: org,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: `zacc_${id}`,
        displayName: "Diluvium",
      });
    }
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  async function contact(firstName: string, org = ORG_A) {
    seq++;
    const id = `c_${seq}`;
    await db.insert(s.contacts).values({ id, organizationId: org, firstName, phoneE164: `+5216680000${String(seq).padStart(3, "0")}` });
    return id;
  }
  async function conversation(contactId: string, lastMessageAt: string, { org = ORG_A, channel = "ch_a" } = {}) {
    seq++;
    const id = `conv_${seq}`;
    await db.insert(s.conversations).values({ id, organizationId: org, contactId, channelId: channel, lastMessageAt: new Date(lastMessageAt) });
    return id;
  }
  async function message(
    convId: string,
    body: string | null,
    sentAt: string,
    opts: { org?: string; type?: string; transcripcion?: string; metadata?: Record<string, unknown>; direction?: "in" | "out" } = {},
  ) {
    seq++;
    const id = `m_${seq}_${randomUUID()}`;
    const direction = opts.direction ?? "in";
    await db.insert(s.messages).values({
      id,
      organizationId: opts.org ?? ORG_A,
      conversationId: convId,
      direction,
      source: direction === "in" ? "contact" : "crm",
      type: (opts.type ?? "text") as "text",
      body,
      status: direction === "in" ? "received" : "sent",
      sentAt: new Date(sentAt),
      transcripcion: opts.transcripcion ?? null,
      metadata: opts.metadata ?? null,
    });
    return id;
  }

  it("Bandeja: con la lupa solo quedan los chats con la palabra, sin acentos, con cuántos y la más reciente", async () => {
    const laura = await conversation(await contact("Laura"), "2026-09-29T10:31:00Z");
    await message(laura, "¿Me pueden dar FACTURA?", "2026-09-29T10:07:00Z");
    await message(laura, "Claro, le facturamos hoy", "2026-09-29T10:09:00Z", { direction: "out" });
    await message(laura, "Ya les mandé la constancia para la factura", "2026-09-29T10:31:00Z");
    const jorge = await conversation(await contact("Jorge"), "2026-09-29T09:00:00Z");
    await message(jorge, "¿Hacen instalación en Culiacán?", "2026-09-29T09:00:00Z");
    // Otra organización con la misma palabra: nunca aparece.
    const otra = await conversation(await contact("Otra", ORG_B), "2026-09-29T11:00:00Z", { org: ORG_B, channel: "ch_b" });
    await message(otra, "factura", "2026-09-29T11:00:00Z", { org: ORG_B });

    const page = await q.listConversationsForOrg(ORG_A, { search: "Factura", searchChats: true });
    expect(page.items.map((i) => i.id)).toEqual([laura]);
    expect(page.items[0].chatMatch).toEqual({ count: 3, text: "Ya les mandé la constancia para la factura" });

    const accent = await q.listConversationsForOrg(ORG_A, { search: "culiacan", searchChats: true });
    expect(accent.items.map((i) => i.id)).toEqual([jorge]);
    expect(accent.items[0].chatMatch?.count).toBe(1);

    // Filas por id (tiempo real): mismo filtro y las mismas coincidencias.
    const fresh = await q.listConversationItemsByIdsForOrg(ORG_A, [laura, jorge], { search: "factura", searchChats: true });
    expect(fresh.map((i) => [i.id, i.chatMatch?.count])).toEqual([[laura, 3]]);
  });

  it("Bandeja: menos de 3 letras no filtra; sin la lupa se busca por nombre como siempre", async () => {
    const laura = await conversation(await contact("Laura"), "2026-09-29T10:00:00Z");
    await message(laura, "factura", "2026-09-29T10:00:00Z");
    const ana = await conversation(await contact("Ana"), "2026-09-29T09:00:00Z");
    await message(ana, "hola", "2026-09-29T09:00:00Z");

    const short = await q.listConversationsForOrg(ORG_A, { search: "fa", searchChats: true });
    expect(short.items.map((i) => i.id).sort()).toEqual([ana, laura].sort());
    expect(short.items.every((i) => i.chatMatch === null)).toBe(true);

    const byName = await q.listConversationsForOrg(ORG_A, { search: "factura" });
    expect(byName.items).toEqual([]);
    const byNameAna = await q.listConversationsForOrg(ORG_A, { search: "ana" });
    expect(byNameAna.items.map((i) => [i.id, i.chatMatch])).toEqual([[ana, null]]);
  });

  it("busca en transcripciones y pies de foto; deja fuera avisos internos y la sombra del aviso no disponible", async () => {
    const conv = await conversation(await contact("Ramón"), "2026-09-29T10:00:00Z");
    await message(conv, null, "2026-09-29T09:00:00Z", { type: "audio", transcripcion: "quiero la cotización para la cochera" });
    await message(conv, "Foto de la cochera", "2026-09-29T09:10:00Z", { type: "image" });
    await message(conv, "Cotejar depósito de la cochera", "2026-09-29T09:20:00Z", { type: "system_note", direction: "out" });
    await message(conv, "cochera", "2026-09-29T09:30:00Z", { metadata: { noDisponible: { estado: "sombra" } } });

    const page = await q.listConversationsForOrg(ORG_A, { search: "cochera", searchChats: true });
    expect(page.items[0].chatMatch).toEqual({ count: 2, text: "Foto de la cochera" });
    // La palabra solo en la transcripción: la vista previa es la transcripción.
    const onlyAudio = await q.listConversationsForOrg(ORG_A, { search: "cotizacion", searchChats: true });
    expect(onlyAudio.items[0].chatMatch).toEqual({ count: 1, text: "quiero la cotización para la cochera" });
    const onlyNote = await q.listConversationsForOrg(ORG_A, { search: "cotejar", searchChats: true });
    expect(onlyNote.items).toEqual([]);
  });

  it("Embudo: por contacto suma todos sus chats; solo los que tienen la palabra; aislado por organización", async () => {
    const laura = await contact("Laura");
    const c1 = await conversation(laura, "2026-09-29T10:00:00Z");
    const c2 = await conversation(laura, "2026-09-29T11:00:00Z", { channel: "ch_a2" });
    await message(c1, "¿Me dan factura?", "2026-09-29T10:00:00Z");
    await message(c2, "La factura, por favor", "2026-09-29T11:00:00Z");
    await message(c2, "gracias", "2026-09-29T11:05:00Z");
    const ana = await contact("Ana");
    await message(await conversation(ana, "2026-09-29T09:00:00Z"), "hola", "2026-09-29T09:00:00Z");
    const otra = await contact("Otra", ORG_B);
    await message(await conversation(otra, "2026-09-29T09:00:00Z", { org: ORG_B, channel: "ch_b" }), "factura", "2026-09-29T09:00:00Z", { org: ORG_B });

    expect(await cs.searchChatsByContactForOrg(ORG_A, "factura")).toEqual([[laura, 2]]);
    expect(await cs.searchChatsByContactForOrg(ORG_B, "factura")).toEqual([[otra, 1]]);
  });

  it("barra «1 de N»: ids del más reciente al más viejo, solo de ese chat; los comodines de LIKE no cuelan", async () => {
    const conv = await conversation(await contact("Laura"), "2026-09-29T10:00:00Z");
    const viejo = await message(conv, "descuento del 50% hoy", "2026-09-29T08:00:00Z");
    await message(conv, "hola", "2026-09-29T09:00:00Z");
    const nuevo = await message(conv, "¿sigue el 50% de descuento?", "2026-09-29T10:00:00Z");
    const otro = await conversation(await contact("Ana"), "2026-09-29T10:00:00Z");
    await message(otro, "descuento", "2026-09-29T10:00:00Z");

    expect(await cs.listChatMatchIdsForOrg(ORG_A, conv, "descuento")).toEqual([nuevo, viejo]);
    expect(await cs.listChatMatchIdsForOrg(ORG_A, conv, "50%")).toEqual([nuevo, viejo]);
    expect(await cs.listChatMatchIdsForOrg(ORG_A, conv, "5_%")).toEqual([]);
    expect(await cs.listChatMatchIdsForOrg(ORG_B, conv, "descuento")).toEqual([]);
  });

  it("la consulta usa el índice de trigramas de la 0050 (misma expresión)", async () => {
    const { like } = await import("drizzle-orm");
    const query = db
      .select({ id: s.messages.id })
      .from(s.messages)
      .where(like(cs.messageSearchText, "%factura%"))
      .toSQL();
    const client = db.$client as unknown as {
      begin: <T>(fn: (tx: { unsafe: (text: string, params?: unknown[]) => Promise<Array<Record<string, string>>> }) => Promise<T>) => Promise<T>;
    };
    const plan = await client.begin(async (tx) => {
      await tx.unsafe("set local enable_seqscan = off");
      return tx.unsafe(`explain ${query.sql}`, query.params);
    });
    expect(plan.map((row) => Object.values(row)[0]).join("\n")).toContain("messages_busqueda_idx");
  });
});
