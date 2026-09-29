// Doble verificación del aviso "no disponible" (caso SDA, 29-sep-2026) contra
// Postgres REAL: ingesta → verificación → Bandeja y Agente IA. Los casos salen de
// producción (lib/messaging/unavailable.ts). Solo corren con TEST_DATABASE_URL
// apuntando a una base DESECHABLE con las migraciones aplicadas.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)('doble verificación del aviso "no disponible" (Postgres real)', () => {
  let db: Db;
  let s: Schema;
  let ingest: typeof import("./ingest");
  let check: typeof import("./unavailable-check");
  let rules: typeof import("./unavailable");
  let inbox: typeof import("@/lib/inbox/queries");
  let context: typeof import("@/lib/ai/runtime/context");
  let ZernioProvider: typeof import("./zernio").ZernioProvider;
  const ORG = "org_nd";
  const NOTICE_131060 = { code: 131060, title: "This message is unavailable.", details: "This message is currently unavailable." };
  const NOTICE_131051 = { code: 131051, title: "Message type unknown", details: "Message type is currently not supported." };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("./ingest");
    check = await import("./unavailable-check");
    rules = await import("./unavailable");
    inbox = await import("@/lib/inbox/queries");
    context = await import("@/lib/ai/runtime/context");
    ({ ZernioProvider } = await import("./zernio"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate webhook_events, messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.channels).values({
      id: "ch_nd",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_nd",
      displayName: "Diluvium",
    });
    zernio = { mode: "vacio" };
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  // ── Zernio de mentira: la copia que guarda de cada mensaje (GET …/messages) ──
  let zernio: { mode: "vacio" | "contenido" | "falla"; text?: string };
  const requests: string[] = [];
  function provider() {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (zernio.mode === "falla") throw new Error("ECONNRESET");
      const wamid = [...seen.values()].at(-1) ?? "";
      const stored =
        zernio.mode === "contenido"
          ? { id: wamid, message: zernio.text ?? "Quiero más información", metadata: {} }
          : { id: wamid, message: "[Unsupported message]", metadata: { unsupported: NOTICE_131060 } };
      return new Response(JSON.stringify({ messages: [stored], pagination: { hasMore: false } }), { status: 200 });
    }) as typeof fetch;
    return new ZernioProvider({ apiKey: "k", webhookSecret: "s", baseUrl: "https://zernio.test/api" }, fetchImpl);
  }

  let seq = 0;
  const seen = new Set<string>();
  function event(opts: { wamid?: string; sentAt: string; text: string; metadata?: Record<string, unknown>; phone?: string }) {
    seq++;
    const phone = opts.phone ?? "5216680000101";
    const wamid = opts.wamid ?? `wamid.nd.${seq}.${randomUUID()}`;
    seen.add(wamid);
    return {
      id: `evt_${seq}_${randomUUID()}`,
      event: "message.received",
      timestamp: opts.sentAt,
      message: {
        id: `zmsg_${seq}`,
        conversationId: `zconv_${phone}`,
        platform: "whatsapp",
        platformMessageId: wamid,
        direction: "incoming",
        text: opts.text,
        attachments: [],
        sender: { id: phone, name: "Cliente", phoneNumber: phone },
        sentAt: opts.sentAt,
      },
      conversation: { id: `zconv_${phone}`, participantId: phone, participantName: "Cliente" },
      account: { id: "zacc_nd", platform: "whatsapp" },
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    };
  }
  const notice = (sentAt: string, wamid?: string, code = NOTICE_131060) =>
    event({ wamid, sentAt, text: "[Unsupported message]", metadata: { unsupported: code } });
  const real = (sentAt: string, text = "Quiero más información", wamid?: string) => event({ wamid, sentAt, text });

  type Calls = { verify: string[]; inbound: string[] };
  async function deliver(payload: { id: string; event: string }, calls: Calls = { verify: [], inbound: [] }) {
    const id = `zernio_${payload.id}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: payload.event, payload });
    return ingest.processWebhookEvent(provider(), id, {
      onInboundMessage: (m) => void calls.inbound.push(m.messageId),
      onUnavailableNotice: (m) => void calls.verify.push(m.messageId),
    });
  }
  const rows = () => db.select().from(s.messages).orderBy(s.messages.sentAt);
  const conversation = async () => (await db.select().from(s.conversations))[0];
  const later = (ms: number) => new Date(Date.now() + ms);
  function hooks() {
    const woke = { recovered: [] as string[], confirmed: [] as string[], media: [] as string[] };
    const h: import("./unavailable-check").VerifyHooks = {
      onMediaMessage: (id) => void woke.media.push(id),
      onRecovered: (m) => void woke.recovered.push(m.messageId),
      onConfirmedUnavailable: (m) => void woke.confirmed.push(m.messageId),
    };
    return { h, woke };
  }

  it("SDA: el aviso 131060 del primer mensaje nace verificando; ni Agente IA ni burbuja cruda", async () => {
    const calls: Calls = { verify: [], inbound: [] };
    expect(await deliver(notice("2026-09-29T00:16:36Z"), calls)).toBe("entrante guardado");
    const [row] = await rows();
    expect(rules.noDisponibleEstado(row.metadata)).toBe("verificando");
    expect(calls.verify).toEqual([row.id]);
    expect(calls.inbound).toEqual([]);
    const c = await conversation();
    expect(c.unreadCount).toBe(1);
    expect(await context.pendingInbound(ORG, c.id)).toEqual([]);
    const page = await inbox.listMessagesForOrg(ORG, c.id);
    expect(page?.messages.map((m) => [m.body, m.noDisponible])).toEqual([[rules.NOTICE_RECEIVING_TEXT, "verificando"]]);
    const list = await inbox.listConversationsForOrg(ORG);
    expect(list.items[0].lastMessage?.preview).toBe(rules.NOTICE_RECEIVING_TEXT);
  });

  it("antes de 20 s no se decide (el real llega en 0–5 s)", async () => {
    await deliver(notice("2026-09-29T00:16:36Z"));
    const [row] = await rows();
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: row.id }, {}, later(5_000))).toBe("esperando");
    expect(rules.noDisponibleEstado((await rows())[0].metadata)).toBe("verificando");
  });

  it("no llegó nada y Zernio tampoco lo tiene → tarjeta, vista previa y el Agente IA lo atiende con la nota", async () => {
    await deliver(notice("2026-09-29T00:16:36Z"));
    const [row] = await rows();
    const { h, woke } = hooks();
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: row.id }, h, later(25_000))).toBe("sin_contenido");
    expect(requests.at(-1)).toContain("/v1/inbox/conversations/zconv_5216680000101/messages?accountId=zacc_nd");
    expect(woke.confirmed).toEqual([row.id]);
    expect(woke.recovered).toEqual([]);

    const c = await conversation();
    expect(c.unreadCount).toBe(1);
    const page = await inbox.listMessagesForOrg(ORG, c.id);
    expect(page?.messages.map((m) => [m.body, m.noDisponible, m.direction])).toEqual([[rules.NOTICE_CARD_TEXT, "sin_contenido", "in"]]);
    expect((await inbox.listConversationsForOrg(ORG)).items[0].lastMessage?.preview).toBe(rules.NOTICE_CARD_TEXT);
    // El Agente IA lo tiene pendiente y en el historial lo lee como lo que es.
    expect((await context.pendingInbound(ORG, c.id)).map((m) => m.id)).toEqual([row.id]);
    expect((await context.loadHistory(ORG, c.id)).map((m) => m.body)).toEqual([rules.UNAVAILABLE_HISTORY_NOTE]);
    // Decidido UNA vez: otra verificación ya no aplica.
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: row.id }, h, later(90_000))).toBe("no_aplica");
    expect(woke.confirmed).toHaveLength(1);
  });

  it("caso real del 29-sep: el real llega con OTRO wamid 2 s después → el aviso se oculta al instante (1 no leído)", async () => {
    const calls: Calls = { verify: [], inbound: [] };
    await deliver(notice("2026-09-29T17:03:52Z"), calls);
    await deliver(real("2026-09-29T17:03:54Z"), calls);
    const [shadow, realRow] = await rows();
    expect(rules.noDisponibleEstado(shadow.metadata)).toBe("sombra");
    expect(shadow.metadata?.noDisponible).toMatchObject({ mensajeReal: realRow.id });
    expect(calls.inbound).toEqual([realRow.id]); // solo el real despierta al Agente IA
    const c = await conversation();
    expect(c.unreadCount).toBe(1);
    const page = await inbox.listMessagesForOrg(ORG, c.id);
    expect(page?.messages.map((m) => m.body)).toEqual(["Quiero más información"]);
    expect((await inbox.listConversationsForOrg(ORG)).items[0].lastMessage?.preview).toBe("Quiero más información");
    expect((await context.pendingInbound(ORG, c.id)).map((m) => m.id)).toEqual([realRow.id]);
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: shadow.id }, {}, later(25_000))).toBe("no_aplica");
  });

  it("webhooks desordenados: el real se procesó ANTES que su aviso → el aviso nace como sombra", async () => {
    const calls: Calls = { verify: [], inbound: [] };
    await deliver(real("2026-09-29T17:03:54Z"), calls);
    await deliver(notice("2026-09-29T17:03:52Z"), calls);
    const [shadow] = await rows();
    expect(rules.noDisponibleEstado(shadow.metadata)).toBe("sombra");
    expect(calls.verify).toEqual([]);
    expect((await conversation()).unreadCount).toBe(1);
  });

  it("27-sep 15:31: otro texto 19 s después NO es la sombra (fuera de la ventana) → sin contenido", async () => {
    await deliver(notice("2026-09-27T22:31:01Z"));
    await deliver(real("2026-09-27T22:31:20Z", "Es la misma medida"));
    const [first] = await rows();
    expect(rules.noDisponibleEstado(first.metadata)).toBe("verificando");
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: first.id }, {}, later(25_000))).toBe("sin_contenido");
    expect((await conversation()).unreadCount).toBe(2);
  });

  it("Zernio sí tiene el contenido → se completa la fila y despierta como un entrante nuevo", async () => {
    await deliver(notice("2026-09-29T00:16:36Z"));
    const [row] = await rows();
    zernio = { mode: "contenido", text: "Quiero más información" };
    const { h, woke } = hooks();
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: row.id }, h, later(25_000))).toBe("recuperado");
    const [done] = await rows();
    expect(done.body).toBe("Quiero más información");
    expect(done.metadata?.unsupported).toBeUndefined();
    expect(done.metadata?.noDisponible).toBeUndefined();
    expect(done.metadata?.noDisponibleAntes).toMatchObject({ code: 131060, verificacion: "verificando" });
    expect(woke.recovered).toEqual([row.id]);
    expect(woke.confirmed).toEqual([]);
  });

  it("Zernio no responde: se reintenta; pasados 3 min se decide con la base (el cliente no se queda esperando)", async () => {
    await deliver(notice("2026-09-29T00:16:36Z"));
    const [row] = await rows();
    zernio = { mode: "falla" };
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: row.id }, {}, later(25_000))).toBe("reintentar");
    expect(rules.noDisponibleEstado((await rows())[0].metadata)).toBe("verificando");
    // El barrido lo recoge (más de 45 s).
    expect((await check.noticesToVerify(later(60_000))).map((n) => n.messageId)).toEqual([row.id]);
    expect(await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: row.id }, {}, later(4 * 60_000))).toBe("sin_contenido");
  });

  it("el real con el MISMO wamid después de decidir → la tarjeta se reemplaza por el mensaje y despierta al Agente IA", async () => {
    const calls: Calls = { verify: [], inbound: [] };
    await deliver(notice("2026-09-29T00:16:36Z", "wamid.sda"), calls);
    const [row] = await rows();
    await check.verifyUnavailableNotice(provider(), { organizationId: ORG, messageId: row.id }, {}, later(25_000));
    expect(await deliver(real("2026-09-29T00:16:37Z", "Quiero más información", "wamid.sda"), calls)).toBe(
      "entrante completado (antes no disponible)",
    );
    const [done] = await rows();
    expect(done.id).toBe(row.id);
    expect(done.body).toBe("Quiero más información");
    expect(done.metadata?.noDisponibleAntes).toMatchObject({ verificacion: "sin_contenido" });
    expect(calls.inbound).toEqual([row.id]);
    const page = await inbox.listMessagesForOrg(ORG, (await conversation()).id);
    expect(page?.messages.map((m) => [m.body, m.noDisponible])).toEqual([["Quiero más información", null]]);
  });

  it("estricto (caso SDA y nada más): un 131051, o un 131060 que NO es el primer mensaje, queda como antes", async () => {
    const calls: Calls = { verify: [], inbound: [] };
    await deliver(notice("2026-09-28T23:38:11Z", undefined, NOTICE_131051), calls);
    await deliver(real("2026-09-28T23:40:00Z", "hola"), calls);
    await deliver(notice("2026-09-28T23:45:00Z"), calls);
    const all = await rows();
    expect(all.map((m) => rules.noDisponibleEstado(m.metadata))).toEqual([null, null, null]);
    expect(calls.verify).toEqual([]);
    expect(all[0].body).toBe("[Unsupported message]");
    expect(all[2].body).toBe("[Unsupported message]");
  });

  it("otro chat (otro teléfono) nunca es la sombra de este", async () => {
    await deliver(notice("2026-09-29T17:03:52Z"));
    await deliver(event({ sentAt: "2026-09-29T17:03:54Z", text: "Quiero más información", phone: "5216680000102" }));
    const sda = (await rows()).find((m) => m.body === "[Unsupported message]")!;
    expect(rules.noDisponibleEstado(sda.metadata)).toBe("verificando");
  });
});
