// Historial del celular contra Postgres REAL. La base debe ser desechable y
// tener todas las migraciones; cada prueba borra sus datos antes de empezar.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingProvider, NormalizedMessageEvent } from "./provider";
import type { ZernioHistoryClient } from "./zernio-history";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("historial del celular (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let ingest: typeof import("./ingest");
  let history: typeof import("./history");
  let importer: typeof import("./history-import");
  let replay: typeof import("./replay");
  let provider: MessagingProvider;
  let eq: typeof import("drizzle-orm").eq;

  const ORG = "org_history";
  const REAL = "ch_history_real";
  const TEST = "ch_history_test";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("./ingest");
    history = await import("./history");
    importer = await import("./history-import");
    replay = await import("./replay");
    ({ eq } = await import("drizzle-orm"));
    const { ZernioProvider } = await import("./zernio");
    provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Historial", slug: "history", createdAt: new Date() });
    await db.insert(s.channels).values([
      {
        id: REAL,
        organizationId: ORG,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: "zacc_1",
        displayName: "Número real",
      },
      {
        id: TEST,
        organizationId: ORG,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: "zacc_test",
        displayName: "Número de prueba",
        isTest: true,
      },
    ]);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  function payload(opts: {
    account?: string;
    phone?: string;
    conv?: string;
    wamid?: string;
    sentAt?: string;
    outgoing?: boolean;
    source?: string;
    history?: boolean;
    text?: string;
  } = {}) {
    seq++;
    const account = opts.account ?? "zacc_1";
    const phone = opts.phone ?? "5216682410001";
    const conv = opts.conv ?? `zconv_${account}_${phone}`;
    const outgoing = opts.outgoing ?? false;
    const sentAt = opts.sentAt ?? "2026-09-18T10:00:00Z";
    return {
      id: `evt_history_${seq}_${randomUUID()}`,
      event: outgoing ? "message.sent" : "message.received",
      timestamp: sentAt,
      message: {
        id: `zmsg_history_${seq}_${randomUUID()}`,
        conversationId: conv,
        platform: "whatsapp",
        platformMessageId: opts.wamid ?? `wamid.history.${seq}.${randomUUID()}`,
        direction: outgoing ? "outgoing" : "incoming",
        text: opts.text ?? `mensaje ${seq}`,
        attachments: [],
        sender: outgoing ? { id: account, name: "Diluvium" } : { id: phone, name: "Cliente", phoneNumber: phone },
        sentAt,
        ...(opts.source ? { source: opts.source } : {}),
      },
      conversation: { id: conv, participantId: phone, participantName: "Cliente" },
      account: { id: account, platform: "whatsapp" },
      ...(opts.history ? { metadata: { source: "coexistence_history" } } : {}),
    };
  }

  async function deliver(raw: ReturnType<typeof payload> | Record<string, unknown>, hooks: import("./ingest").IngestHooks = {}) {
    const rowId = `zernio_${String(raw.id)}`;
    await db.insert(s.webhookEvents).values({ id: rowId, provider: "zernio", event: String(raw.event), payload: raw });
    return ingest.processWebhookEvent(provider, rowId, hooks);
  }

  async function channel(id = REAL) {
    const [row] = await db.select().from(s.channels).where(eq(s.channels.id, id));
    return row;
  }

  function normalized(raw: ReturnType<typeof payload>): NormalizedMessageEvent {
    const event = provider.normalize(raw);
    if (event.kind !== "message") throw new Error("se esperaba mensaje normalizado");
    return event;
  }

  it("webhooks entrante y saliente de historial se guardan sin activar conversación ni ganchos", async () => {
    const hooks = { onInboundMessage: vi.fn(), onHumanOutbound: vi.fn(), onMediaMessage: vi.fn() };
    const inboundAt = "2026-01-02T10:00:00Z";
    const outgoingAt = "2026-01-02T10:05:00Z";
    await deliver(payload({ history: true, sentAt: inboundAt, conv: "zconv_hist_webhook" }), hooks);
    await deliver(
      payload({ history: true, outgoing: true, source: "cloud_api", sentAt: outgoingAt, conv: "zconv_hist_webhook" }),
      hooks,
    );

    const rows = (await db.select().from(s.messages)).sort(
      (a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((m) => ({ direction: m.direction, source: m.source }))).toEqual([
      { direction: "in", source: "contact" },
      { direction: "out", source: "business_app" },
    ]);
    expect(rows.map((m) => m.sentAt?.toISOString())).toEqual([
      "2026-01-02T10:00:00.000Z",
      "2026-01-02T10:05:00.000Z",
    ]);
    expect(rows.every((m) => m.importedAt !== null)).toBe(true);
    const [conv] = await db.select().from(s.conversations);
    expect(conv).toMatchObject({ status: "open", unreadCount: 0, windowExpiresAt: null, firstResponseSeconds: null });
    expect(hooks.onInboundMessage).not.toHaveBeenCalled();
    expect(hooks.onHumanOutbound).not.toHaveBeenCalled();
    expect(hooks.onMediaMessage).not.toHaveBeenCalled();
  });

  it("el mismo wamid por importación repetida y luego por webhook deja una sola fila", async () => {
    const ch = await channel();
    const raw = payload({ history: true, wamid: "wamid.HISTORY.DUP", conv: "zconv_hist_dup" });
    const event = normalized(raw);
    await expect(history.ingestHistoryMessage("zernio", ch, event)).resolves.toMatchObject({ result: "importado" });
    await expect(history.ingestHistoryMessage("zernio", ch, event)).resolves.toMatchObject({ result: "duplicado" });
    await deliver({ ...raw, id: `evt_hist_dup_${randomUUID()}`, message: { ...raw.message, id: `zmsg_${randomUUID()}` } });
    expect(await db.select().from(s.messages)).toHaveLength(1);
  });

  it("el historial respeta no leídos y ventana de una conversación viva, y last_message_at toma el máximo", async () => {
    await db.insert(s.contacts).values({ id: "c_live", organizationId: ORG, firstName: "Ana", phoneE164: "+526682410001" });
    await db.insert(s.conversations).values({
      id: "conv_live",
      organizationId: ORG,
      contactId: "c_live",
      channelId: REAL,
      providerConversationId: "zconv_live",
      unreadCount: 2,
      windowExpiresAt: new Date("2026-09-19T10:00:00Z"),
      lastMessageAt: new Date("2026-09-18T10:00:00Z"),
    });
    const ch = await channel();
    await history.ingestHistoryMessage("zernio", ch, normalized(payload({ history: true, conv: "zconv_live", sentAt: "2026-08-01T10:00:00Z" })));
    let [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, "conv_live"));
    expect(conv.unreadCount).toBe(2);
    expect(conv.status).toBe("open");
    expect(conv.windowExpiresAt?.toISOString()).toBe("2026-09-19T10:00:00.000Z");
    expect(conv.lastMessageAt.toISOString()).toBe("2026-09-18T10:00:00.000Z");

    await history.ingestHistoryMessage("zernio", ch, normalized(payload({ history: true, conv: "zconv_live", sentAt: "2026-09-18T11:00:00Z" })));
    [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, "conv_live"));
    expect(conv.lastMessageAt.toISOString()).toBe("2026-09-18T11:00:00.000Z");
  });

  it("la primera respuesta se calcula solo con el entrante y eco vivos posteriores al historial", async () => {
    const conv = "zconv_first_live";
    await deliver(payload({ history: true, conv, sentAt: "2026-01-01T10:00:00Z" }));
    await deliver(payload({ history: true, outgoing: true, conv, sentAt: "2026-01-01T10:01:00Z" }));
    await deliver(payload({ conv, sentAt: "2026-09-18T12:00:00Z" }));
    await deliver(payload({ outgoing: true, source: "whatsapp_business_app", conv, sentAt: "2026-09-18T12:03:00Z" }));

    const [row] = await db.select().from(s.conversations);
    expect(row.firstResponseSeconds).toBe(180);
  });

  it("un contacto creado por historial nace en Inbox, con source historial_celular y prueba según el canal", async () => {
    await deliver(payload({ history: true, phone: "5216682410101", account: "zacc_1" }));
    await deliver(payload({ history: true, phone: "5216682410102", account: "zacc_test" }));
    const rows = await db.select().from(s.contacts);
    expect(rows).toHaveLength(2);
    expect(rows.find((c) => c.phoneE164 === "+526682410101")).toMatchObject({
      source: "historial_celular",
      stage: "inbox",
      esPrueba: false,
    });
    expect(rows.find((c) => c.phoneE164 === "+526682410102")).toMatchObject({
      source: "historial_celular",
      stage: "inbox",
      esPrueba: true,
    });
  });

  it("el historial reutiliza un contacto +52 cuando Zernio manda +521", async () => {
    await db.insert(s.contacts).values({
      id: "c_existing",
      organizationId: ORG,
      firstName: "Nombre real",
      phoneE164: "+526682410103",
      source: "whatsapp",
    });
    await deliver(payload({ history: true, phone: "+5216682410103", conv: "zconv_existing" }));
    const contacts = await db.select().from(s.contacts);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ id: "c_existing", firstName: "Nombre real", source: "whatsapp" });
  });

  it("fillEmptyContactNames solo rellena placeholders existentes, incluidas variantes +521", async () => {
    await db.insert(s.contacts).values([
      { id: "c_placeholder", organizationId: ORG, firstName: "Cliente de WhatsApp", phoneE164: "+526682410110" },
      { id: "c_phone", organizationId: ORG, firstName: "526682410111", phoneE164: "+526682410111" },
      { id: "c_legacy", organizationId: ORG, firstName: "+5216682410112", phoneE164: "+526682410112" },
      { id: "c_real_name", organizationId: ORG, firstName: "Patricia", phoneE164: "+526682410113" },
    ]);
    const before = await db.select().from(s.contacts);
    const result = await history.fillEmptyContactNames(ORG, [
      { phoneE164: "+526682410110", name: "Ana" },
      { phoneE164: "+5216682410111", name: "Beatriz" },
      { phoneE164: "+526682410112", name: "Carla" },
      { phoneE164: "+526682410113", name: "No debe pisar" },
      { phoneE164: "+526682419999", name: "No debe crear" },
    ]);
    expect(result).toEqual({ filled: 3, skipped: 2 });
    const rows = await db.select().from(s.contacts);
    expect(rows).toHaveLength(before.length);
    expect(Object.fromEntries(rows.map((c) => [c.id, c.firstName]))).toMatchObject({
      c_placeholder: "Ana",
      c_phone: "Beatriz",
      c_legacy: "Carla",
      c_real_name: "Patricia",
    });
  });

  it("un canal archivado registra mensajes y estados sin aplicarlos ni llamar ganchos", async () => {
    await db.update(s.channels).set({ isActive: false, archivedAt: new Date() }).where(eq(s.channels.id, REAL));
    const hooks = { onInboundMessage: vi.fn(), onHumanOutbound: vi.fn(), onMediaMessage: vi.fn() };
    const incoming = payload({ phone: "5216682410201" });
    await expect(deliver(incoming, hooks)).resolves.toContain("canal archivado");
    const status = {
      id: `evt_archived_status_${randomUUID()}`,
      event: "message.read",
      timestamp: "2026-09-18T10:01:00Z",
      message: { platformMessageId: "wamid.inexistente" },
      account: { id: "zacc_1", platform: "whatsapp" },
    };
    await expect(deliver(status, hooks)).resolves.toContain("canal archivado");

    expect(await db.select().from(s.messages)).toHaveLength(0);
    expect(await db.select().from(s.contacts)).toHaveLength(0);
    expect(await db.select().from(s.conversations)).toHaveLength(0);
    const events = await db.select().from(s.webhookEvents);
    expect(events).toHaveLength(2);
    expect(events.every((row) => row.processedAt !== null && row.lastError?.includes("canal archivado"))).toBe(true);
    expect(hooks.onInboundMessage).not.toHaveBeenCalled();
    expect(hooks.onHumanOutbound).not.toHaveBeenCalled();
    expect(hooks.onMediaMessage).not.toHaveBeenCalled();
  });

  it("la ingesta viva marca prueba solo si el contacto no tiene conversación en un canal real", async () => {
    await deliver(payload({ account: "zacc_test", phone: "5216682410301" }));
    await db.insert(s.contacts).values({ id: "c_real", organizationId: ORG, firstName: "Real", phoneE164: "+526682410302" });
    await db.insert(s.conversations).values({
      id: "conv_real_existing",
      organizationId: ORG,
      contactId: "c_real",
      channelId: REAL,
      providerConversationId: "zconv_real_existing",
    });
    await deliver(payload({ account: "zacc_test", phone: "5216682410302", conv: "zconv_test_existing" }));

    const rows = await db.select().from(s.contacts);
    expect(rows.find((c) => c.phoneE164 === "+526682410301")?.esPrueba).toBe(true);
    expect(rows.find((c) => c.id === "c_real")?.esPrueba).toBe(false);
  });

  it("un cliente importado de GHL (sin conversaciones) que escribe al canal de prueba, en vivo o en el historial, NO se marca prueba", async () => {
    await db.insert(s.contacts).values([
      { id: "c_ghl_vivo", organizationId: ORG, firstName: "Cliente GHL", phoneE164: "+526682410401", source: "ghl_import" },
      { id: "c_ghl_hist", organizationId: ORG, firstName: "Cliente GHL 2", phoneE164: "+526682410402", source: "ghl_import" },
    ]);
    await deliver(payload({ account: "zacc_test", phone: "5216682410401", conv: "zconv_ghl_vivo" }));
    await deliver(payload({ account: "zacc_test", phone: "5216682410402", conv: "zconv_ghl_hist", history: true, sentAt: "2026-03-01T10:00:00Z" }));

    const rows = await db.select().from(s.contacts);
    expect(rows).toHaveLength(2);
    expect(rows.every((c) => c.esPrueba === false)).toBe(true);
  });

  it("con hora de conexión, un webhook SIN la marca de historial pero enviado antes de conectar entra como historial (sin agente ni no leídos)", async () => {
    await db.update(s.channels).set({ connectedAt: new Date("2026-09-20T12:00:00Z") }).where(eq(s.channels.id, TEST));
    const hooks = { onInboundMessage: vi.fn(), onHumanOutbound: vi.fn(), onMediaMessage: vi.fn() };
    // Copia vieja SIN marca (Zernio podría mandarla así) y un mensaje vivo después de conectar.
    await deliver(payload({ account: "zacc_test", phone: "5216682410501", conv: "zconv_corte", sentAt: "2026-09-10T09:00:00Z" }), hooks);
    await deliver(payload({ account: "zacc_test", phone: "5216682410501", conv: "zconv_corte", outgoing: true, source: "whatsapp_business_app", sentAt: "2026-09-10T09:05:00Z" }), hooks);
    expect(hooks.onInboundMessage).not.toHaveBeenCalled();
    expect(hooks.onHumanOutbound).not.toHaveBeenCalled();
    let [conv] = await db.select().from(s.conversations).where(eq(s.conversations.providerConversationId, "zconv_corte"));
    expect(conv).toMatchObject({ unreadCount: 0, windowExpiresAt: null, firstResponseSeconds: null });

    await deliver(payload({ account: "zacc_test", phone: "5216682410501", conv: "zconv_corte", sentAt: "2026-09-20T12:00:05Z" }), hooks);
    expect(hooks.onInboundMessage).toHaveBeenCalledTimes(1);
    [conv] = await db.select().from(s.conversations).where(eq(s.conversations.providerConversationId, "zconv_corte"));
    expect(conv.unreadCount).toBe(1);
    const rows = await db.select().from(s.messages).where(eq(s.messages.conversationId, conv.id));
    expect(rows.filter((m) => m.importedAt !== null)).toHaveLength(2);
    expect(rows.filter((m) => m.importedAt === null)).toHaveLength(1);
  });

  it("el historial importado nunca es el corte de lectura ni cuenta como no leído", async () => {
    await deliver(payload({ account: "zacc_1", phone: "5216682410601", conv: "zconv_leido", sentAt: "2026-09-18T10:00:00Z" }));
    const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.providerConversationId, "zconv_leido"));
    const [live] = await db.select().from(s.messages).where(eq(s.messages.conversationId, conv.id));
    // El importador guarda una copia vieja DESPUÉS (created_at más nuevo) del entrante vivo.
    await history.ingestHistoryMessage("zernio", await channel(REAL), normalized(payload({ history: true, phone: "5216682410601", conv: "zconv_leido", sentAt: "2026-05-01T10:00:00Z" })));
    expect(await ingest.latestInboundMessageId(conv.id)).toBe(live.id);
    const unread = await db.transaction((tx) => ingest.unreadAfterCutoff(tx, { id: conv.id, unreadCount: 1 }, live.id));
    expect(unread).toBe(0);
  });

  it("un adjunto del historial sin URL queda guardado como no disponible (tipo intacto, sin descarga)", async () => {
    const onMediaMessage = vi.fn();
    const base = normalized(payload({ history: true, phone: "5216682410701", conv: "zconv_sin_url", sentAt: "2026-04-01T10:00:00Z" }));
    const event: NormalizedMessageEvent = {
      ...base,
      type: "image",
      body: null,
      attachments: [{ type: "image", url: "", mimeType: "image/jpeg", unavailable: "El historial del celular no trae este archivo" }],
    };
    await history.ingestHistoryMessage("zernio", await channel(REAL), event, { onMediaMessage });
    const [row] = await db.select().from(s.messages).where(eq(s.messages.providerMessageId, base.providerMessageId));
    expect(row.type).toBe("image");
    expect(row.mediaUrl).toBeNull();
    expect(row.attachments[0]).toMatchObject({ type: "image", downloadAttempts: 25, downloadError: "El historial del celular no trae este archivo" });
    expect(row.attachments[0]).not.toHaveProperty("unavailable");
    expect(onMediaMessage).not.toHaveBeenCalled();
  });

  it("el eco vivo de la app se guarda como business_app, llama al gancho y no cambia ventana ni no leídos", async () => {
    await db.insert(s.contacts).values({ id: "c_echo", organizationId: ORG, firstName: "Ana", phoneE164: "+526682410401" });
    const expires = new Date("2026-09-19T10:00:00Z");
    await db.insert(s.conversations).values({
      id: "conv_echo",
      organizationId: ORG,
      contactId: "c_echo",
      channelId: REAL,
      providerConversationId: "zconv_echo",
      unreadCount: 4,
      windowExpiresAt: expires,
    });
    const onHumanOutbound = vi.fn();
    await deliver(
      payload({ outgoing: true, source: "whatsapp_business_app", phone: "5216682410401", conv: "zconv_echo" }),
      { onHumanOutbound },
    );
    const [message] = await db.select().from(s.messages);
    expect(message).toMatchObject({ direction: "out", source: "business_app", importedAt: null });
    expect(onHumanOutbound).toHaveBeenCalledOnce();
    const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, "conv_echo"));
    expect(conv.unreadCount).toBe(4);
    expect(conv.windowExpiresAt?.toISOString()).toBe(expires.toISOString());
  });

  it("la cuarentena solo se libera al permitir su cuenta y luego el evento se puede procesar", async () => {
    const raw = payload({ account: "zacc_new", phone: "5216682410501" });
    const id = `zernio_${raw.id}`;
    await db.insert(s.webhookEvents).values({
      id,
      provider: "zernio",
      event: raw.event,
      payload: raw,
      quarantinedAt: new Date(),
      attempts: 7,
      lastError: "cuenta no permitida",
    });
    await expect(ingest.processWebhookEvent(provider, id)).resolves.toContain("cuarentena");
    expect(await db.select().from(s.messages)).toHaveLength(0);

    expect(await replay.replayWebhookEvents(new Set(["zacc_1"]))).toEqual({ replayed: 0, released: 0, kept: 1 });
    let [event] = await db.select().from(s.webhookEvents);
    expect(event.quarantinedAt).not.toBeNull();
    expect(await replay.replayWebhookEvents(new Set(["zacc_1", "zacc_new"]))).toEqual({ replayed: 0, released: 1, kept: 0 });
    [event] = await db.select().from(s.webhookEvents);
    expect(event).toMatchObject({ quarantinedAt: null, attempts: 0, lastError: null });

    await db.insert(s.channels).values({
      id: "ch_new",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_new",
      displayName: "Nuevo",
    });
    await expect(ingest.processWebhookEvent(provider, id)).resolves.toBe("entrante guardado");
    expect(await db.select().from(s.messages)).toHaveLength(1);
  });

  it("importPhoneHistory importa solo coexistence_history, simula dry-run, deduplica y rechaza canal archivado", async () => {
    const fakeClient = {
      async *conversations() {
        yield { id: "zconv_import", participantId: "+5216682410601", participantName: "Ana" };
      },
      async *messages() {
        yield {
          id: "wamid.IMPORT.1",
          platform: "whatsapp",
          message: "viejo 1",
          direction: "incoming",
          sentAt: "2026-01-01T10:00:00Z",
          metadata: { source: "coexistence_history" },
        };
        yield {
          id: "wamid.LIVE.IGNORED",
          platform: "whatsapp",
          message: "vivo",
          direction: "incoming",
          sentAt: "2026-01-01T10:01:00Z",
          metadata: { source: "live" },
        };
        yield {
          id: "wamid.IMPORT.2",
          platform: "whatsapp",
          message: "viejo 2",
          direction: "outgoing",
          createdAt: "2026-01-01T10:02:00Z",
          metadata: { source: "coexistence_history" },
        };
      },
      async *contacts() {
        yield { phoneE164: "+526682410601", name: "Ana Agenda" };
      },
    } as unknown as ZernioHistoryClient;

    const dry = await importer.importPhoneHistory(fakeClient, "zacc_1", { dryRun: true });
    expect(dry).toMatchObject({ conversaciones: 1, importados: 2, duplicados: 0, noHistorial: 1, nombresRellenados: 0 });
    expect(await db.select().from(s.messages)).toHaveLength(0);

    const first = await importer.importPhoneHistory(fakeClient, "zacc_1", { withContacts: false });
    expect(first).toMatchObject({ importados: 2, duplicados: 0, noHistorial: 1 });
    const second = await importer.importPhoneHistory(fakeClient, "zacc_1", { withContacts: false });
    expect(second).toMatchObject({ importados: 0, duplicados: 2, noHistorial: 1 });
    expect(await db.select().from(s.messages)).toHaveLength(2);

    await db.update(s.channels).set({ isActive: false, archivedAt: new Date() }).where(eq(s.channels.id, REAL));
    await expect(importer.importPhoneHistory(fakeClient, "zacc_1")).rejects.toThrow(/inactivo o archivado/);
  });
});
