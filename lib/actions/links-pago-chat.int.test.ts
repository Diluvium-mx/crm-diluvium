// Links de pago en el ⚡ del chat (30-oct-2026) contra Postgres REAL: el vendedor manda los dos mensajes en orden
// (el del link y el de los datos de envío) y el contacto pasa a Cerca de compra; los «Solo vendedor» también
// salen ahí; a un número de fuera de México nada (tampoco un link de la lista pegado a mano; +1 sí).
// Solo con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingProvider, SendResult } from "@/lib/messaging/provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.REDIS_URL;

const ORG = "org_links_chat";
const sent = vi.hoisted(() => ({ texts: [] as string[] }));

vi.mock("@/lib/auth/active-organization", () => ({
  requireActiveMembership: async () => ({ organizationId: "org_links_chat", userId: "u_links", role: "agent" }),
}));
vi.mock("@/lib/messaging", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/messaging")>();
  let n = 0;
  const send = async (input: { text?: string }): Promise<SendResult> => {
    n++;
    if (input.text) sent.texts.push(input.text);
    return { providerInternalId: `pint_links_${n}`, providerMessageId: `wamid.links.out.${n}.${crypto.randomUUID()}` };
  };
  return { ...orig, messagingProvider: () => ({ name: "zernio", sendText: send, sendTemplate: send }) as unknown as MessagingProvider };
});

describe.skipIf(!TEST_DATABASE_URL)("Links de pago en el ⚡ del chat (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let chat: typeof import("./links-pago-chat");
  let inbox: typeof import("@/lib/inbox/actions");
  let store: typeof import("@/lib/agente-ia/links-pago-store");
  let phone: typeof import("@/lib/phone");

  const CHATS = { mx: "+526681110001", eu: "+16195550101", pe: "+51987654322" } as const;
  type Chat = keyof typeof CHATS;
  const conv = (c: Chat) => `conv_lc_${c}`;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    chat = await import("./links-pago-chat");
    inbox = await import("@/lib/inbox/actions");
    store = await import("@/lib/agente-ia/links-pago-store");
    phone = await import("@/lib/phone");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    sent.texts = [];
    await db.execute(d.sql`truncate links_pago, links_pago_textos, messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-links-chat", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_links", name: "Vendedor", email: "v-links@x.mx" });
    await db.insert(s.channels).values({ id: "ch_lc", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_lc", displayName: "Diluvium", aiAgentMode: "off" });
    for (const c of Object.keys(CHATS) as Chat[]) {
      await db.insert(s.contacts).values({ id: `ct_lc_${c}`, organizationId: ORG, firstName: "Cliente", stage: "interesado", ...phone.phoneColumns(CHATS[c]) });
      await db.insert(s.conversations).values({ id: conv(c), organizationId: ORG, contactId: `ct_lc_${c}`, channelId: "ch_lc", providerConversationId: `zconv_lc_${c}`, windowExpiresAt: new Date(Date.now() + 20 * 3_600_000) });
    }
    await store.replaceLinksPago(ORG, [
      { nombre: "1 compuerta estándar", monto: 5500, cubre: "total", meses: 6, url: "https://mpago.la/EJEMPLO1" },
      { nombre: "2 compuertas (especial)", monto: 10400, cubre: "total", meses: 6, url: "https://mpago.la/EJEMPLO9", soloVendedor: true },
    ], null);
  });

  const outs = async (c: Chat) =>
    (await db.select().from(s.messages).where(d.and(d.eq(s.messages.conversationId, conv(c)), d.eq(s.messages.direction, "out"))).orderBy(s.messages.createdAt)).map((m) => [m.source, m.body]);
  const linkId = async (nombre: string) => (await store.listLinksPago(ORG)).find((l) => l.nombre === nombre)!.id;

  it("lista todos los links (también los «Solo vendedor»); a Perú, apagada con el motivo", async () => {
    const mx = await chat.listLinksPagoDelChat(conv("mx"));
    expect(mx.links.map((l) => [l.nombre, l.soloVendedor])).toEqual([["1 compuerta estándar", false], ["2 compuertas (especial)", true]]);
    expect(mx.bloqueo).toBeNull();
    expect((await chat.listLinksPagoDelChat(conv("eu"))).bloqueo).toBeNull();
    expect((await chat.listLinksPagoDelChat(conv("pe"))).bloqueo).toContain("Perú");
  });

  it("«Mandar»: el del link y, aparte, el de los datos de envío, como mensajes del vendedor; el contacto pasa a Cerca de compra", async () => {
    expect(await chat.sendLinkPago(conv("mx"), await linkId("2 compuertas (especial)"))).toEqual({ ok: true, sent: 2 });
    const o = await outs("mx");
    expect(o.map(([source]) => source)).toEqual(["crm", "crm"]);
    expect(o[0][1]).toContain("$10,400");
    expect(o[0][1]).toContain("https://mpago.la/EJEMPLO9");
    expect(o[1][1]).toMatch(/^Una vez realizado el pago, nos apoya con sus datos de envío:/);
    expect(sent.texts).toHaveLength(2);
    const [contact] = await db.select().from(s.contacts).where(d.eq(s.contacts.id, "ct_lc_mx"));
    expect(contact.stage).toBe("cerca_compra");
  });

  it("a Perú no sale nada: ni con «Mandar» ni pegando a mano un link de la lista; otro link sí; +1 sí", async () => {
    const r = await chat.sendLinkPago(conv("pe"), await linkId("1 compuerta estándar"));
    expect(r).toEqual({ ok: false, message: expect.stringContaining("fuera de México") });
    const pegado = await inbox.sendMessage(conv("pe"), "Aquí está: https://mpago.la/EJEMPLO1");
    expect(pegado).toMatchObject({ ok: false, message: expect.stringContaining("no se le mandan links de pago") });
    expect(await outs("pe")).toEqual([]);
    expect((await inbox.sendMessage(conv("pe"), "Nuestra página: https://diluvium.com.mx")).ok).toBe(true);
    expect((await chat.sendLinkPago(conv("eu"), await linkId("1 compuerta estándar"))).ok).toBe(true);
  });
});
