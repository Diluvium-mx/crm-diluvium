// Importador del historial del celular a escala, contra Postgres REAL y un Zernio
// FALSO con la forma documentada (test/zernio-historial-falso.ts). La base debe ser
// desechable y tener todas las migraciones; cada prueba borra sus datos antes de empezar.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { fakeZernioFetch, type FakeChat, type FakeMessage, type FakeWorld } from "@/test/zernio-historial-falso";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const DAY = 86_400_000;
const ACCOUNT = "zacc_oficial";

describe.skipIf(!TEST_DATABASE_URL)("importador del historial del número oficial (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let importer: typeof import("./history-import");
  let state: typeof import("./history-state");
  let history: typeof import("./history");
  let zh: typeof import("./zernio-history");
  let sweep: typeof import("@/lib/ai/runtime/sweep");
  let context: typeof import("@/lib/ai/runtime/context");
  let inbox: typeof import("@/lib/inbox/queries");
  let signals: typeof import("@/lib/contacts/funnel-signals");
  let dashboard: typeof import("@/lib/dashboard/queries");
  let rules: typeof import("@/lib/ai/transcription/rules");
  let sql: typeof import("drizzle-orm").sql;
  let eq: typeof import("drizzle-orm").eq;

  const ORG = "org_oficial";
  const CHANNEL = "ch_zernio_oficial";
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    importer = await import("./history-import");
    state = await import("./history-state");
    history = await import("./history");
    zh = await import("./zernio-history");
    sweep = await import("@/lib/ai/runtime/sweep");
    context = await import("@/lib/ai/runtime/context");
    inbox = await import("@/lib/inbox/queries");
    signals = await import("@/lib/contacts/funnel-signals");
    dashboard = await import("@/lib/dashboard/queries");
    rules = await import("@/lib/ai/transcription/rules");
    ({ sql, eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "diluvium-oficial", createdAt: new Date() });
    await db.insert(s.channels).values({
      id: CHANNEL,
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: ACCOUNT,
      displayName: "WhatsApp Diluvium",
      connectedAt: new Date(now - 60 * 60_000),
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  function msg(direction: "in" | "out", msAgo: number, text: string | null, extra: Partial<FakeMessage> = {}): FakeMessage {
    seq++;
    return { id: `wamid.T${seq}`, direction: direction === "in" ? "incoming" : "outgoing", message: text, sentAt: iso(msAgo), attachments: [], ...extra };
  }
  function chat(id: string, participantId: string | null, messages: FakeMessage[], extra: Partial<FakeChat> = {}): FakeChat {
    return { id, participantId, participantName: `Cliente ${id}`, messages, ...extra };
  }

  function clientFor(world: FakeWorld, fetchOpts: Parameters<typeof fakeZernioFetch>[1] = {}) {
    const fetchImpl = fakeZernioFetch(world, fetchOpts);
    const c = new zh.ZernioHistoryClient(
      { apiKey: "k", baseUrl: "https://zernio.test/api", pacing: { minIntervalMs: 0, sleep: async () => undefined } },
      fetchImpl,
    );
    return { client: c, fetchImpl };
  }

  async function counts() {
    const [row] = await db.execute<{ contacts: number; conversations: number; messages: number; distinct_wamids: number }>(sql`
      select (select count(*) from contacts)::int as contacts,
             (select count(*) from conversations)::int as conversations,
             (select count(*) from messages)::int as messages,
             (select count(distinct provider_message_id) from messages)::int as distinct_wamids`);
    return row;
  }

  async function ghl(id: string, phone: string, extra: Partial<typeof s.contacts.$inferInsert> = {}) {
    await db.insert(s.contacts).values({ id, organizationId: ORG, firstName: `GHL ${id}`, phoneE164: phone, source: "ghl_import", ghlContactId: `ghl_${id}`, ...extra });
  }

  it("pega cada chat al contacto de GHL aunque Zernio escriba el teléfono distinto (+52, 521, sin +, espacios) y crea solo los que no existen", async () => {
    await ghl("a", "+526681000001");
    await ghl("b", "+526681000002");
    await ghl("c", "+526681000003");
    await ghl("d", "+5216681000004"); // guardado con el 1 heredado
    await ghl("e", "+526681000005");
    const world: FakeWorld = {
      accountId: ACCOUNT,
      chats: [
        chat("z1", "5216681000001", [msg("in", 40 * DAY, "hola"), msg("out", 40 * DAY - 60_000, "buen día")]),
        chat("z2", "+526681000002", [msg("in", 30 * DAY, "precio?")]),
        chat("z3", "526681000003", [msg("in", 20 * DAY, "info")]),
        chat("z4", "+52 668 100 0004", [msg("in", 10 * DAY, "medidas")]),
        chat("z5", "+521 668 100 0005", [msg("in", 9 * DAY, "gracias")]),
        chat("z6", "5216681000006", [msg("in", 8 * DAY, "nuevo 1")]),
        chat("z7", "+15551230007", [msg("in", 7 * DAY, "new 2")]),
      ],
      contacts: [],
    };
    const { client } = clientFor(world);
    const report = await importer.importPhoneHistory(client, ACCOUNT, { withContacts: false });

    expect(report.contactos).toEqual({ existentesGhl: 5, existentes: 0, nuevos: 2, conversacionExistente: 0 });
    expect(report.importados).toBe(8);
    expect(report.ambiguos).toEqual([]);
    const rows = await db.select().from(s.contacts);
    expect(rows).toHaveLength(7);
    const nuevos = rows.filter((c) => c.source === "historial_celular");
    expect(nuevos.map((c) => c.phoneE164).sort()).toEqual(["+15551230007", "+526681000006"]);
    // Nacen en Inbox, SIN la marca Prueba (el canal oficial no es de prueba); nunca +521.
    expect(nuevos.every((c) => c.stage === "inbox" && c.esPrueba === false)).toBe(true);
    expect(rows.some((c) => c.phoneE164?.startsWith("+521") && c.source !== "ghl_import")).toBe(false);
    // Los de GHL conservan nombre, etapa y source.
    expect(rows.filter((c) => c.source === "ghl_import")).toHaveLength(5);
  });

  it("si el teléfono coincide con MÁS de un contacto no adivina: no importa ese chat y lo reporta", async () => {
    await ghl("dup1", "+526682000001");
    await db.insert(s.contacts).values({ id: "dup2", organizationId: ORG, firstName: "Otro", phoneE164: "+5216682000001", source: "whatsapp" });
    const world: FakeWorld = {
      accountId: ACCOUNT,
      chats: [chat("amb", "5216682000001", [msg("in", 5 * DAY, "¿a quién soy?")]), chat("ok", "5216682000009", [msg("in", 5 * DAY, "hola")])],
      contacts: [],
    };
    const before = await counts();
    const sim = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { dryRun: true, withContacts: false });
    expect(sim.ambiguos).toEqual([{ conversacion: "amb", telefono: "+526682000001", contactos: expect.arrayContaining(["dup1", "dup2"]) }]);
    expect(sim.duplicadosEnCrm).toEqual([{ telefono: "+526682000001", contactos: expect.arrayContaining(["dup1", "dup2"]) }]);
    expect(await counts()).toEqual(before); // simular no escribe nada

    const real = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { withContacts: false });
    expect(real.ambiguos).toEqual([{ conversacion: "amb", telefono: "+526682000001", contactos: ["dup1", "dup2"] }]);
    expect(real.importados).toBe(1);
    const convs = await db.select().from(s.conversations);
    expect(convs.map((c) => c.providerConversationId)).toEqual(["ok"]);
    expect((await counts()).contacts).toBe(before.contacts + 1);
  });

  it("grupos y chats sin teléfono válido no se importan y quedan en el reporte", async () => {
    const world: FakeWorld = {
      accountId: ACCOUNT,
      chats: [
        chat("grupo", "120363000000000000", [msg("in", DAY, "hola grupo")], { isGroup: true }),
        chat("sin_tel", "usuario.sin.telefono", [msg("in", DAY, "hola")]),
        chat("archivado", "5216683000003", [msg("in", 3 * DAY, "viejo archivado")], { archived: true }),
      ],
      contacts: [],
    };
    const report = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { withContacts: false });
    expect(report.conversaciones).toBe(3);
    expect(report.grupos).toBe(1);
    expect(report.sinTelefono).toEqual([{ conversacion: "sin_tel", participante: "usuario.sin.telefono" }]);
    // El archivado en Zernio SÍ se importa (el listado incluye archivadas).
    expect(report.importados).toBe(1);
    expect((await counts()).contacts).toBe(1);
  });

  it("un grupo SIN la marca isGroup (id …@g.us, o sin participante y con varios remitentes) no se pega a ningún miembro", async () => {
    await ghl("miembro", "+526683100001");
    const world: FakeWorld = {
      accountId: ACCOUNT,
      chats: [
        chat("g1", "120363040000000001@g.us", [msg("in", DAY, "hola a todos", { senderId: "5216683100001" })]),
        chat("g2", null, [msg("in", 2 * DAY, "yo", { senderId: "5216683100001" }), msg("in", 2 * DAY - 60_000, "y yo", { senderId: "5216683100002" })]),
        chat("solo", null, [msg("in", 3 * DAY, "sin participante, un solo remitente", { senderId: "5216683100003" })]),
      ],
      contacts: [],
    };
    const report = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { withContacts: false });
    expect(report.grupos).toBe(2);
    expect(report.importados).toBe(1);
    const convs = await db.select().from(s.conversations);
    expect(convs.map((c) => c.providerConversationId)).toEqual(["solo"]);
    // El miembro de GHL no recibió la conversación del grupo.
    expect(convs.some((c) => c.contactId === "miembro")).toBe(false);
  });

  it("la agenda solo rellena nombres vacíos de contactos existentes: no crea contactos ni cambia un nombre puesto", async () => {
    await db.insert(s.contacts).values([
      { id: "vacio", organizationId: ORG, firstName: "Cliente de WhatsApp", phoneE164: "+526684000001" },
      { id: "tel", organizationId: ORG, firstName: "+52 668 400 0002", phoneE164: "+526684000002" },
      { id: "puesto", organizationId: ORG, firstName: "Patricia", phoneE164: "+526684000003", source: "ghl_import" },
    ]);
    const world: FakeWorld = {
      accountId: ACCOUNT,
      chats: [],
      contacts: [
        { name: "Ana Agenda", platformIdentifier: "5216684000001" },
        { name: "Beto Agenda", platformIdentifier: "+526684000002" },
        { name: "No pisa", platformIdentifier: "+526684000003" },
        { name: "Solo agenda sin chat", platformIdentifier: "+526684000099" },
      ],
    };
    const sim = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { dryRun: true });
    expect(sim.agenda).toMatchObject({ leidos: 4, rellenables: 2, sinContacto: 1 });
    const report = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, {});
    expect(report.agenda).toMatchObject({ leidos: 4, rellenados: 2 });
    const rows = Object.fromEntries((await db.select().from(s.contacts)).map((c) => [c.id, c.firstName]));
    expect(rows).toEqual({ vacio: "Ana Agenda", tel: "Beto Agenda", puesto: "Patricia" });
  });

  it("corte a la mitad (Ctrl+C) → reanuda donde se quedó; una segunda corrida completa no duplica nada", async () => {
    const chats: FakeChat[] = [];
    for (let i = 0; i < 12; i++) {
      const phone = `521668500${String(i).padStart(4, "0")}`;
      const messages = Array.from({ length: 150 }, (_, j) => msg(j % 2 ? "out" : "in", (200 - j) * 60_000 + i * DAY, `m${i}-${j}`));
      chats.push(chat(`r${i}`, phone, messages));
    }
    const world: FakeWorld = { accountId: ACCOUNT, chats, contacts: [] };
    const store = state.memoryStateStore();
    const controller = new AbortController();
    let pages = 0;
    const first = clientFor(world, {
      onRequest: (url) => {
        if (url.pathname.endsWith("/messages") && ++pages === 9) controller.abort(); // a media conversación
      },
    });
    const cut = await importer.importPhoneHistory(first.client, ACCOUNT, { state: store, signal: controller.signal, withContacts: false });
    expect(cut.cortado).toBe(true);
    expect(cut.terminado).toBe(false);
    expect(store.current?.finished).toBe(false);
    const doneAfterCut = store.current!.done.length;
    expect(doneAfterCut).toBeGreaterThan(0);
    expect(doneAfterCut).toBeLessThan(12);

    const resumed = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { state: store, withContacts: false });
    expect(resumed.reanudadas).toBe(doneAfterCut);
    expect(resumed.terminado).toBe(true);
    expect(store.current?.finished).toBe(true);
    let c = await counts();
    expect(c).toMatchObject({ contacts: 12, conversations: 12, messages: 12 * 150, distinct_wamids: 12 * 150 });
    expect(cut.importados + resumed.importados).toBe(12 * 150);

    // Terminada, la siguiente corrida es una pasada COMPLETA (Zernio pudo copiar más): cero nuevos.
    const again = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { state: store, withContacts: false });
    expect(again).toMatchObject({ reanudadas: 0, importados: 0, duplicados: 12 * 150 });
    c = await counts();
    expect(c).toMatchObject({ contacts: 12, conversations: 12, messages: 12 * 150, distinct_wamids: 12 * 150 });
  });

  it("aguanta 429 y 5xx de Zernio sin perder ni repetir mensajes", async () => {
    const chats = Array.from({ length: 6 }, (_, i) =>
      chat(`t${i}`, `52166860000${i}`, Array.from({ length: 230 }, (_, j) => msg("in", (300 - j) * 60_000, `x${i}-${j}`))),
    );
    const { client, fetchImpl } = clientFor({ accountId: ACCOUNT, chats, contacts: [] }, { throttleEvery: 4, failEvery: 7 });
    const report = await importer.importPhoneHistory(client, ACCOUNT, { withContacts: false });
    expect(report.importados).toBe(6 * 230);
    expect(client.stats.throttled).toBeGreaterThan(0);
    expect(client.stats.retries).toBeGreaterThan(0);
    expect(fetchImpl.calls).toBe(client.stats.requests);
    expect(await counts()).toMatchObject({ messages: 6 * 230, distinct_wamids: 6 * 230 });
  });

  it("tiempo real: ningún aviso por fila durante la importación; una señal inbox.bulk por cada 500 mensajes", async () => {
    const chats = Array.from({ length: 12 }, (_, i) =>
      chat(`n${i}`, `52166870000${String(i).padStart(2, "0")}`, Array.from({ length: 100 }, (_, j) => msg("in", (400 - j) * 60_000, `n${i}-${j}`))),
    );
    const listener = postgres(TEST_DATABASE_URL!, { max: 1 });
    const events: { org: string; type: string; mensajes?: number; contactos?: number }[] = [];
    await listener.listen("inbox_events", (payload) => events.push(JSON.parse(payload)));
    try {
      const report = await importer.importPhoneHistory(clientFor({ accountId: ACCOUNT, chats, contacts: [] }).client, ACCOUNT, {
        withContacts: false,
        bulkSignal: { messages: 500, ms: 1e9 },
      });
      expect(report.importados).toBe(1_200);
      await new Promise((r) => setTimeout(r, 300));
      const ours = events.filter((e) => e.org === ORG);
      expect(ours.every((e) => e.type === "inbox.bulk")).toBe(true);
      expect(ours.map((e) => e.mensajes)).toEqual([500, 500, 200]);
      expect(ours.reduce((sum, e) => sum + (e.contactos ?? 0), 0)).toBe(12);
      expect(report.avisosEnLote).toBe(3);

      // Fuera del importador, todo sigue avisando fila por fila (webhook, envíos, pantallas).
      events.length = 0;
      await db.update(s.conversations).set({ isStarred: true }).where(eq(s.conversations.providerConversationId, "n0"));
      await new Promise((r) => setTimeout(r, 300));
      expect(events.filter((e) => e.org === ORG).map((e) => e.type)).toEqual(["conversation.updated"]);
    } finally {
      await listener.end();
    }
  });

  it("nada del historial dispara agente, workflows, no leídos, ventana, primera respuesta, semáforo, etapa, temperatura ni Dashboard; los adjuntos viejos quedan no disponibles", async () => {
    // Agente ENCENDIDO en el oficial desde hace una hora (el peor caso: import con AUTO).
    await db.update(s.channels).set({ aiAgentMode: "auto", aiAgentModeChangedAt: new Date(now - 60 * 60_000) }).where(eq(s.channels.id, CHANNEL));
    // X: cliente de GHL en "prospecto" y "caliente".
    await ghl("x", "+526689000001", { stage: "prospecto", temperature: "caliente", stageChangedAt: new Date(now - 90 * DAY) });
    // Z: cliente de GHL que YA escribió en vivo hace 5 min (sin contestar todavía).
    await ghl("z", "+526689000003");
    await db.insert(s.conversations).values({
      id: "conv_z",
      organizationId: ORG,
      contactId: "z",
      channelId: CHANNEL,
      providerConversationId: "zz",
      unreadCount: 1,
      windowExpiresAt: new Date(now + 23 * 3_600_000),
      lastMessageAt: new Date(now - 5 * 60_000),
    });
    await db.insert(s.messages).values({
      id: "live_z",
      organizationId: ORG,
      conversationId: "conv_z",
      direction: "in",
      source: "contact",
      type: "text",
      body: "hola, ¿siguen vendiendo?",
      status: "received",
      providerMessageId: "wamid.LIVE.Z",
      sentAt: new Date(now - 5 * 60_000),
      createdAt: new Date(now - 5 * 60_000),
    });

    const old = 45 * DAY;
    const world: FakeWorld = {
      accountId: ACCOUNT,
      chats: [
        chat("xx", "5216689000001", [
          msg("in", old, "tamaños"), // palabra clave de workflow
          msg("out", old - 60_000, "Te paso la tabla"),
          msg("in", old - 120_000, null, { attachments: [{ id: "a1", type: "audio", url: "https://zernio.test/api/v1/whatsapp/media/a1", mimeType: "audio/ogg" }] }),
          msg("in", old - 180_000, null, { attachments: [{ id: "i1", type: "image", url: "https://zernio.test/api/v1/whatsapp/media/i1", mimeType: "image/jpeg" }] }),
          msg("in", 5 * DAY, null, { attachments: [{ id: "i2", type: "image", url: "https://zernio.test/api/v1/whatsapp/media/i2", mimeType: "image/jpeg" }] }),
          msg("in", 4 * DAY, null, { attachments: [{ id: "d1", type: "file", url: null, mimeType: "application/pdf", filename: "cotizacion.pdf" }] }),
          msg("in", 4 * DAY - 60_000, "¿precio?"), // sin contestar: el historial termina en el cliente
        ]),
        chat("yy", "5216689000002", [msg("in", 20 * DAY, "cómo se instalan"), msg("in", 20 * DAY - 60_000, "¿hola?")]),
        // Z: su historial viejo termina con un "gracias" sin contestar, ANTES de su mensaje vivo.
        chat("zz", "5216689000003", [msg("in", 60 * DAY, "¿tienen de 1 metro?"), msg("out", 60 * DAY - 60_000, "Sí"), msg("in", 60 * DAY - 120_000, "gracias 👍")]),
      ],
      contacts: [],
    };
    const report = await importer.importPhoneHistory(clientFor(world).client, ACCOUNT, { withContacts: false });
    expect(report.importados).toBe(12);
    expect(report.adjuntos).toEqual({ recientesConArchivo: 1, viejosConArchivo: 2, sinArchivo: 1 });

    const conv = async (pid: string) => (await db.select().from(s.conversations).where(eq(s.conversations.providerConversationId, pid)))[0];
    const cx = await conv("xx");
    const cy = await conv("yy");
    const cz = await conv("zz");
    // Historial = registro: sin no leídos, sin ventana, sin primera respuesta, abierta y con el agente como estaba.
    for (const c of [cx, cy]) {
      expect(c).toMatchObject({ unreadCount: 0, windowExpiresAt: null, firstResponseSeconds: null, status: "open", agentState: "activo" });
    }
    // La conversación viva de Z no cambió por el historial.
    expect(cz).toMatchObject({ id: "conv_z", unreadCount: 1, firstResponseSeconds: null });
    expect(cz.windowExpiresAt?.getTime()).toBe(now + 23 * 3_600_000);
    expect(cz.lastMessageAt.getTime()).toBe(now - 5 * 60_000);

    // Etapa y temperatura intactas; el nuevo nace en Inbox sin marca Prueba.
    const [x] = await db.select().from(s.contacts).where(eq(s.contacts.id, "x"));
    expect(x).toMatchObject({ stage: "prospecto", temperature: "caliente", source: "ghl_import" });
    expect(x.stageChangedAt?.getTime()).toBe(now - 90 * DAY);
    const [y] = await db.select().from(s.contacts).where(eq(s.contacts.phoneE164, "+526689000002"));
    expect(y).toMatchObject({ stage: "inbox", source: "historial_celular", esPrueba: false, temperature: null });

    // Agente: el barrido no rescata historial (X, Y) y en Z solo el mensaje VIVO está pendiente.
    const orphans = (await sweep.findOrphanConversations(new Date(now))).map((o) => o.conversationId);
    expect(orphans).not.toContain(cx.id);
    expect(orphans).not.toContain(cy.id);
    expect(await sweep.findPendingAtOpening(new Date(now))).toEqual([]);
    expect(await context.pendingInbound(ORG, cx.id)).toEqual([]);
    expect(await context.pendingInbound(ORG, cy.id)).toEqual([]);
    expect((await context.pendingInbound(ORG, "conv_z")).map((m) => m.id)).toEqual(["live_z"]);
    expect(await context.inboundCount(ORG, "conv_z")).toBe(1);

    // Ni IA, ni workflows, ni avisos.
    const [side] = await db.execute<{ usage: number; runs: number; notices: number }>(sql`
      select (select count(*) from ai_usage)::int as usage, (select count(*) from workflow_runs)::int as runs,
             (select count(*) from ai_agent_notices)::int as notices`);
    expect(side).toEqual({ usage: 0, runs: 0, notices: 0 });

    // Transcripción: una nota de voz del historial nunca se transcribe (aunque ya estuviera en el bucket).
    const rows = await db.select().from(s.messages).where(eq(s.messages.conversationId, cx.id));
    const audio = rows.find((m) => m.type === "audio")!;
    expect(rules.shouldTranscribe({ ...audio, attachments: [{ ...audio.attachments[0], storageKey: "k" }] }, new Date(now))).toBe(false);
    expect(rules.transcriptionWaitMs(rows, new Date(now))).toBe(0);

    // Adjuntos: >2 semanas = no disponible con su tipo; reciente con archivo = pendiente para el worker.
    const byProvider = (id: string) => rows.find((m) => m.attachments[0]?.providerMediaId === id)!.attachments[0];
    expect(byProvider("a1")).toMatchObject({ type: "audio", downloadAttempts: 25, downloadError: history.OLD_HISTORY_MEDIA_REASON });
    expect(byProvider("i1")).toMatchObject({ type: "image", downloadAttempts: 25, downloadError: history.OLD_HISTORY_MEDIA_REASON });
    expect(byProvider("i2")).toMatchObject({ type: "image", url: "https://zernio.test/api/v1/whatsapp/media/i2" });
    expect(byProvider("i2").downloadAttempts).toBeUndefined();
    expect(byProvider("d1")).toMatchObject({ type: "document", fileName: "cotizacion.pdf", downloadAttempts: 25 });

    // Semáforo y tarjeta del Embudo: nada en rojo ni pendiente por el historial.
    const page = await inbox.listConversationsForOrg(ORG);
    const item = (id: string) => page.items.find((i) => i.id === id)!;
    expect(item(cx.id).awaitingReplySince).toBeNull();
    expect(item(cy.id).awaitingReplySince).toBeNull();
    const funnel = await signals.funnelSignalsForOrg(ORG, [cx.id, cy.id]);
    expect(Object.values(funnel).every((f) => !f.pending && f.unread === 0 && !f.urgent)).toBe(true);

    // Dashboard: ninguna "conversación nueva" por el historial.
    const hoy = new Date(now).toISOString().slice(0, 10);
    const desde = new Date(now - 90 * DAY).toISOString().slice(0, 10);
    const byDay = await dashboard.newConversationsByDay(db, ORG, { desde, hasta: hoy });
    expect(byDay.reduce((sum, d) => sum + d.total, 0)).toBe(0);
  });
});
