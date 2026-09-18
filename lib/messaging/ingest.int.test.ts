// Tests de integración de la ingesta contra Postgres REAL (concurrencia,
// orden inverso, aislamiento entre organizaciones, idempotencia). Solo corren
// con TEST_DATABASE_URL apuntando a una base DESECHABLE con las migraciones
// aplicadas; borran sus datos al empezar. Nunca apuntarlos a staging ni prod.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type Ingest = typeof import("./ingest");

describe.skipIf(!TEST_DATABASE_URL)("ingesta de WhatsApp (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let ingest: Ingest;
  let eq: typeof import("drizzle-orm").eq;
  let provider: import("./provider").MessagingProvider;
  const ORG_A = "org_a";
  const ORG_B = "org_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("./ingest");
    ({ eq } = await import("drizzle-orm"));
    const { ZernioProvider } = await import("./zernio");
    provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
    ]);
    await db.insert(s.channels).values({
      id: "ch_a",
      organizationId: ORG_A,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_1",
      displayName: "Diluvium",
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  function msgEvent(opts: {
    direction?: "incoming" | "outgoing";
    source?: string;
    phone?: string;
    wamid?: string;
    sentAt: string;
    account?: string;
  }) {
    seq++;
    const phone = opts.phone ?? "5216682410001";
    const outgoing = opts.direction === "outgoing";
    return {
      id: `evt_${seq}_${randomUUID()}`,
      event: outgoing ? "message.sent" : "message.received",
      timestamp: opts.sentAt,
      message: {
        id: `zmsg_${seq}`,
        conversationId: `zconv_${phone}`,
        platform: "whatsapp",
        platformMessageId: opts.wamid ?? `wamid.${seq}.${randomUUID()}`,
        direction: opts.direction ?? "incoming",
        text: `mensaje ${seq}`,
        attachments: [],
        sender: outgoing ? { id: "zacc_1" } : { id: phone, name: "Cliente", phoneNumber: phone },
        sentAt: opts.sentAt,
        source: opts.source,
      },
      conversation: { id: `zconv_${phone}`, participantId: phone, participantName: "Cliente" },
      account: { id: opts.account ?? "zacc_1", platform: "whatsapp" },
    };
  }

  async function deliver(payload: { id: string; event: string }) {
    const id = `zernio_${payload.id}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: payload.event, payload });
    return ingest.processWebhookEvent(provider, id);
  }

  it("10 mensajes simultáneos de un número nuevo → 1 contacto, 1 conversación, 10 no leídos", async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      msgEvent({ sentAt: new Date(Date.UTC(2026, 8, 18, 10, 0, i)).toISOString() }),
    );
    await Promise.all(events.map(deliver));

    expect(await db.select().from(s.contacts)).toHaveLength(1);
    const convs = await db.select().from(s.conversations);
    expect(convs).toHaveLength(1);
    expect(convs[0].unreadCount).toBe(10);
    expect(convs[0].windowExpiresAt?.toISOString()).toBe("2026-09-19T10:00:09.000Z");
    expect(await db.select().from(s.messages)).toHaveLength(10);
  });

  it("México: un +521 del webhook encuentra al contacto guardado como +52 (no duplica)", async () => {
    await db.insert(s.contacts).values({
      id: "c_import",
      organizationId: ORG_A,
      firstName: "Importado de GHL",
      phoneE164: "+526682410001",
    });
    await deliver(msgEvent({ phone: "5216682410001", sentAt: "2026-09-18T10:00:00Z" }));
    const contacts = await db.select().from(s.contacts);
    expect(contacts.map((c) => c.id)).toEqual(["c_import"]);
  });

  it("guarda TODOS los adjuntos con nombre y tipo (p. ej. PDF + XML de la factura)", async () => {
    const e = msgEvent({ sentAt: "2026-09-18T10:00:00Z" });
    (e.message as Record<string, unknown>).attachments = [
      { type: "file", url: "https://cdn/f.pdf", payload: { mimeType: "application/pdf", filename: "F-1.pdf" } },
      { type: "file", url: "https://cdn/f.xml", payload: { mimeType: "application/xml", filename: "F-1.xml" } },
    ];
    await deliver(e);
    const [m] = await db.select().from(s.messages);
    expect(m.attachments).toEqual([
      { type: "document", url: "https://cdn/f.pdf", mimeType: "application/pdf", fileName: "F-1.pdf" },
      { type: "document", url: "https://cdn/f.xml", mimeType: "application/xml", fileName: "F-1.xml" },
    ]);
    expect(m.mediaUrl).toBe("https://cdn/f.pdf");
  });

  it("el mismo evento (o el mismo wamid) dos veces no duplica el mensaje", async () => {
    const e = msgEvent({ sentAt: "2026-09-18T10:00:00Z", wamid: "wamid.dup" });
    await deliver(e);
    await expect(ingest.processWebhookEvent(provider, `zernio_${e.id}`)).resolves.toBe("ya procesado");
    await deliver({ ...e, id: "otro_evento_mismo_wamid" });
    expect(await db.select().from(s.messages)).toHaveLength(1);
    const [conv] = await db.select().from(s.conversations);
    expect(conv.unreadCount).toBe(1);
  });

  it("primera respuesta: se calcula aunque el eco de la app se procese ANTES que el entrante", async () => {
    const inbound = msgEvent({ sentAt: "2026-09-18T10:00:00Z" });
    const reply = msgEvent({ direction: "outgoing", source: "whatsapp_business_app", sentAt: "2026-09-18T10:05:00Z" });
    await deliver(reply);
    await deliver(inbound);
    const [conv] = await db.select().from(s.conversations);
    expect(conv.firstResponseSeconds).toBe(300);
    const outs = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(outs[0].source).toBe("business_app");
  });

  it("una difusión/automatización (cloud_api sin enlazar) NO fija la primera respuesta", async () => {
    await deliver(msgEvent({ sentAt: "2026-09-18T10:00:00Z" }));
    await deliver(msgEvent({ direction: "outgoing", source: "cloud_api", sentAt: "2026-09-18T10:01:00Z" }));
    let [conv] = await db.select().from(s.conversations);
    expect(conv.firstResponseSeconds).toBeNull();
    // La respuesta real del vendedor, después, sí la fija.
    await deliver(msgEvent({ direction: "outgoing", source: "whatsapp_business_app", sentAt: "2026-09-18T10:10:00Z" }));
    [conv] = await db.select().from(s.conversations);
    expect(conv.firstResponseSeconds).toBe(600);
  });

  it("estados concurrentes read + delivered tardío: nunca retrocede de read", async () => {
    for (let round = 0; round < 15; round++) {
      const wamid = `wamid.status.${round}`;
      await deliver(msgEvent({ direction: "outgoing", source: "cloud_api", wamid, sentAt: "2026-09-18T10:00:00Z" }));
      const status = (event: string) => ({
        id: `st_${event}_${round}_${randomUUID()}`,
        event,
        message: { platformMessageId: wamid },
        account: { id: "zacc_1", platform: "whatsapp" },
      });
      await Promise.all([deliver(status("message.read")), deliver(status("message.delivered"))]);
      const [m] = await db.select().from(s.messages).where(eq(s.messages.providerMessageId, wamid));
      expect(m.status).toBe("read");
    }
  });

  it("aislamiento: la misma cuenta en otro proveedor/organización no recibe los mensajes", async () => {
    await db.insert(s.channels).values({
      id: "ch_b_meta",
      organizationId: ORG_B,
      type: "whatsapp",
      provider: "meta_cloud",
      providerAccountId: "zacc_1", // mismo id, OTRO proveedor
      displayName: "Otra org",
    });
    await deliver(msgEvent({ sentAt: "2026-09-18T10:00:00Z" }));
    const [m] = await db.select().from(s.messages);
    expect(m.organizationId).toBe(ORG_A);
  });

  it("un estado con id interno no toca mensajes de otra organización", async () => {
    await db.insert(s.channels).values({
      id: "ch_b",
      organizationId: ORG_B,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_2",
      displayName: "B",
    });
    // Mensaje de la org A con id interno zmsg_X.
    const e = msgEvent({ direction: "outgoing", source: "cloud_api", sentAt: "2026-09-18T10:00:00Z" });
    await deliver(e);
    const internalId = e.message.id;
    // Estado que dice venir de la cuenta de B con ese mismo id interno.
    await expect(
      deliver({
        id: `st_cross_${randomUUID()}`,
        event: "message.failed",
        message: { id: internalId, error: { code: 1, message: "x" } },
        account: { id: "zacc_2", platform: "whatsapp" },
      } as { id: string; event: string }),
    ).rejects.toThrow(/aún no existe/);
    const [m] = await db.select().from(s.messages).where(eq(s.messages.providerInternalId, internalId));
    expect(m.status).toBe("sent");
  });

  it("canal sin configurar: el evento queda pendiente (reintentable) y se aplica después", async () => {
    const e = msgEvent({ account: "zacc_nuevo", sentAt: "2026-09-18T10:00:00Z" });
    await expect(deliver(e)).rejects.toBeInstanceOf(ingest.RetryableIngestError);
    const [row] = await db.select().from(s.webhookEvents);
    expect(row.processedAt).toBeNull();

    await db.insert(s.channels).values({
      id: "ch_nuevo",
      organizationId: ORG_A,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_nuevo",
      displayName: "Nuevo",
    });
    await expect(ingest.processWebhookEvent(provider, row.id)).resolves.toBe("entrante guardado");
  });

  it("evento conocido con formato no reconocido: dead-letter visible (no se da por procesado)", async () => {
    const bad = { id: `evt_bad_${randomUUID()}`, event: "message.received", message: { cambio: "de formato" } };
    await expect(deliver(bad)).rejects.toBeInstanceOf(ingest.DeadLetterIngestError);
    const [row] = await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, `zernio_${bad.id}`));
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(ingest.DEAD_LETTER_ATTEMPTS);
    expect(row.lastError).toMatch(/formato no reconocido/);

    // Un evento que el CRM no procesa (nombre desconocido) sí se da por procesado.
    const other = { id: `evt_other_${randomUUID()}`, event: "comment.received" };
    await expect(deliver(other)).resolves.toMatch(/^ignorado/);
  });

  describe("envío desde el CRM", () => {
    async function openConversation() {
      await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@x.mx" }).onConflictDoNothing();
      await deliver(msgEvent({ sentAt: new Date(Date.now() - 60_000).toISOString() }));
      const [conv] = await db.select().from(s.conversations);
      return conv;
    }
    const fakeProvider = (impl: import("./provider").MessagingProvider["sendText"]) =>
      ({ ...provider, sendText: impl }) as import("./provider").MessagingProvider;

    it("envía dentro de la ventana: sent, wamid, autor y primera respuesta", async () => {
      const conv = await openConversation();
      const { sendTextMessage } = await import("./send");
      const p = fakeProvider(async () => ({ providerInternalId: "wamid.CRM1", providerMessageId: "wamid.CRM1" }));
      await sendTextMessage(p, { organizationId: ORG_A, conversationId: conv.id, sentByUserId: "u_vendedor", text: "Claro, ¿de cuántas piezas?" });

      const [m] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
      expect(m).toMatchObject({ status: "sent", source: "crm", sentByUserId: "u_vendedor", providerMessageId: "wamid.CRM1" });
      const [after] = await db.select().from(s.conversations);
      expect(after.unreadCount).toBe(0);
      expect(after.firstResponseSeconds).toBeGreaterThanOrEqual(59);

      // El eco que llega después es duplicado: no crea otra fila.
      await deliver(msgEvent({ direction: "outgoing", source: "cloud_api", wamid: "wamid.CRM1", sentAt: new Date().toISOString() }));
      expect(await db.select().from(s.messages).where(eq(s.messages.direction, "out"))).toHaveLength(1);
    });

    it("si el eco gana la carrera, se conserva UNA fila con la autoría del vendedor", async () => {
      const conv = await openConversation();
      const { sendTextMessage } = await import("./send");
      const p = fakeProvider(async () => {
        await deliver(msgEvent({ direction: "outgoing", source: "cloud_api", wamid: "wamid.RACE", sentAt: new Date().toISOString() }));
        return { providerInternalId: "wamid.RACE", providerMessageId: "wamid.RACE" };
      });
      await sendTextMessage(p, { organizationId: ORG_A, conversationId: conv.id, sentByUserId: "u_vendedor", text: "hola" });
      const outs = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
      expect(outs).toHaveLength(1);
      expect(outs[0]).toMatchObject({ source: "crm", sentByUserId: "u_vendedor", providerMessageId: "wamid.RACE" });
    });

    it("error del proveedor: el mensaje queda failed con su código y el error se propaga", async () => {
      const conv = await openConversation();
      const { sendTextMessage } = await import("./send");
      const { ZernioSendError } = await import("./zernio");
      const p = fakeProvider(async () => {
        throw new ZernioSendError(400, "WINDOW_CLOSED", "fuera de ventana");
      });
      await expect(
        sendTextMessage(p, { organizationId: ORG_A, conversationId: conv.id, sentByUserId: "u_vendedor", text: "x" }),
      ).rejects.toThrow("fuera de ventana");
      const [m] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
      expect(m).toMatchObject({ status: "failed", errorCode: "WINDOW_CLOSED", errorMessage: "fuera de ventana" });
    });

    it("rechaza fuera de la ventana de 24 h y conversaciones de otra organización", async () => {
      const conv = await openConversation();
      const { sendTextMessage, SendRejectedError } = await import("./send");
      const p = fakeProvider(async () => ({ providerInternalId: "x" }));
      await expect(
        sendTextMessage(p, { organizationId: ORG_A, conversationId: conv.id, sentByUserId: "u_vendedor", text: "x", now: new Date(Date.now() + 25 * 3600_000) }),
      ).rejects.toMatchObject({ code: "window_closed" });
      await expect(
        sendTextMessage(p, { organizationId: ORG_B, conversationId: conv.id, sentByUserId: "u_vendedor", text: "x" }),
      ).rejects.toBeInstanceOf(SendRejectedError);
      expect(await db.select().from(s.messages).where(eq(s.messages.direction, "out"))).toHaveLength(0);
    });
  });

  describe("envío: outbox, resultado desconocido y reconciliación (hallazgos 3-5)", () => {
    async function openConversation(unread = 1) {
      await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@x.mx" }).onConflictDoNothing();
      for (let i = 0; i < unread; i++) {
        await deliver(msgEvent({ sentAt: new Date(Date.now() - 60_000 + i).toISOString() }));
      }
      const [conv] = await db.select().from(s.conversations);
      return conv;
    }
    type P = import("./provider").MessagingProvider;
    const withProvider = (overrides: Partial<P>) =>
      ({
        name: "zernio",
        verifyWebhook: () => true,
        readEnvelope: provider.readEnvelope.bind(provider),
        normalize: provider.normalize.bind(provider),
        fetchMedia: provider.fetchMedia.bind(provider),
        sendText: async () => {
          throw new Error("no se esperaba sendText");
        },
        ...overrides,
      }) as P;
    const outs = () => db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    const conv = async () => (await db.select().from(s.conversations))[0];
    const later = (ms: number) => new Date(Date.now() + ms);

    it("timeout tras el POST: queda en cola (send_unknown), sin reintento ni primera respuesta", async () => {
      const c = await openConversation();
      const { sendTextMessage, retryTextMessage, SendRejectedError } = await import("./send");
      const { ZernioSendError } = await import("./zernio");
      const keys: string[] = [];
      const p = withProvider({
        sendText: async (input) => {
          keys.push(input.idempotencyKey);
          throw new ZernioSendError(0, "network", "timeout", "unknown");
        },
      });
      const out = await sendTextMessage(p, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "Precio: $120" });
      expect(out.status).toBe("pending");
      const [m] = await outs();
      expect(m).toMatchObject({ id: out.messageId, status: "queued", errorCode: "send_unknown:network" });
      expect(keys).toEqual([m.id]); // la clave de idempotencia es el id del mensaje
      expect((await conv()).firstResponseSeconds).toBeNull();
      expect((await conv()).unreadCount).toBe(1);
      await expect(retryTextMessage(p, { organizationId: ORG_A, messageId: m.id, sentByUserId: "u_vendedor" })).rejects.toBeInstanceOf(
        SendRejectedError,
      );
    });

    it("ambiguo cuyo eco llegó aparte: no se adivina; Reintentar con la misma clave se fusiona con el eco", async () => {
      const c = await openConversation();
      const { sendTextMessage, expireUnconfirmedSends, retryTextMessage } = await import("./send");
      const { ZernioSendError } = await import("./zernio");
      const failing = withProvider({
        sendText: async () => {
          throw new ZernioSendError(502, "bad_gateway", "502", "unknown");
        },
      });
      const { messageId } = await sendTextMessage(failing, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "Sí hay" });
      // El eco llegó por webhook (sin id interno conocido → fila other_api aparte).
      await deliver(msgEvent({ direction: "outgoing", source: "cloud_api", wamid: "wamid.LOST", sentAt: new Date().toISOString() }));
      expect(await outs()).toHaveLength(2);

      await expect(expireUnconfirmedSends(later(5 * 60_000))).resolves.toBe(0);
      await expect(expireUnconfirmedSends(later(16 * 60_000))).resolves.toBe(1);

      // El vendedor reintenta: Zernio reconoce la clave y devuelve el MISMO wamid.
      const keys: string[] = [];
      const replay = withProvider({
        sendText: async (input) => {
          keys.push(input.idempotencyKey);
          return { providerInternalId: "wamid.LOST", providerMessageId: "wamid.LOST" };
        },
      });
      await retryTextMessage(replay, { organizationId: ORG_A, messageId, sentByUserId: "u_vendedor" });
      expect(keys).toEqual([messageId]);
      const rows = await outs();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ providerMessageId: "wamid.LOST", source: "crm", sentByUserId: "u_vendedor", status: "sent" });
      expect((await conv()).firstResponseSeconds).toBeGreaterThanOrEqual(59);
    });

    it("sin confirmar tras 15 min → failed (send_unconfirmed); reintentar reusa la clave y un doble clic no duplica", async () => {
      const c = await openConversation();
      const { sendTextMessage, expireUnconfirmedSends, retryTextMessage, SEND_UNCONFIRMED } = await import("./send");
      const { ZernioSendError } = await import("./zernio");
      const p0 = withProvider({
        sendText: async () => {
          throw new ZernioSendError(0, "network", "corte", "unknown");
        },
      });
      const { messageId } = await sendTextMessage(p0, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "¿Lo apartamos?" });
      await expect(expireUnconfirmedSends(later(5 * 60_000))).resolves.toBe(0);
      await expect(expireUnconfirmedSends(later(16 * 60_000))).resolves.toBe(1);
      expect((await outs())[0]).toMatchObject({ status: "failed", errorCode: SEND_UNCONFIRMED });

      const keys: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const p1 = withProvider({
        sendText: async (input) => {
          keys.push(input.idempotencyKey);
          await gate;
          return { providerInternalId: "zmsg_R", providerMessageId: "wamid.RETRY" };
        },
      });
      const clicks = [1, 2].map(() => retryTextMessage(p1, { organizationId: ORG_A, messageId, sentByUserId: "u_vendedor" }));
      // Uno de los dos clics pierde la carrera antes de llegar al proveedor.
      await expect(Promise.race(clicks.map((c) => c.then(() => "ok", (e) => e.code)))).resolves.toBe("not_retryable");
      release();
      const settled = await Promise.allSettled(clicks);
      expect(settled.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<unknown>).value)).toEqual([
        { messageId, status: "sent" },
      ]);
      expect(keys).toEqual([messageId]);
      expect(await outs()).toHaveLength(1);
      expect((await outs())[0]).toMatchObject({ status: "sent", providerMessageId: "wamid.RETRY", errorCode: null });
    });

    it("un send_unconfirmed ya no se reintenta pasado el plazo de la clave de idempotencia", async () => {
      const c = await openConversation();
      const { retryTextMessage, SEND_UNCONFIRMED } = await import("./send");
      await db.insert(s.messages).values({
        id: "m_viejo",
        organizationId: ORG_A,
        conversationId: c.id,
        direction: "out",
        source: "crm",
        type: "text",
        body: "hola",
        status: "failed",
        errorCode: SEND_UNCONFIRMED,
        sentByUserId: "u_vendedor",
        sentAt: new Date(Date.now() - 60_000),
        createdAt: new Date(Date.now() - 24 * 3600_000), // primer intento hace 24 h
      });
      const p = withProvider({ sendText: async () => ({ providerInternalId: "x", providerMessageId: "wamid.X" }) });
      await expect(retryTextMessage(p, { organizationId: ORG_A, messageId: "m_viejo", sentByUserId: "u_vendedor" })).rejects.toMatchObject({
        code: "not_retryable",
      });
      expect((await outs())[0]).toMatchObject({ status: "failed", providerMessageId: null });
    });

    it("canal desactivado o de otro proveedor: no envía ni crea la fila", async () => {
      const c = await openConversation();
      const { sendTextMessage } = await import("./send");
      const p = withProvider({ sendText: async () => ({ providerInternalId: "x", providerMessageId: "wamid.NO" }) });
      await db.update(s.channels).set({ isActive: false }).where(eq(s.channels.id, "ch_a"));
      await expect(
        sendTextMessage(p, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "x" }),
      ).rejects.toMatchObject({ code: "channel_unavailable" });
      await db.update(s.channels).set({ isActive: true }).where(eq(s.channels.id, "ch_a"));
      const meta = { ...p, name: "meta_cloud" } as import("./provider").MessagingProvider;
      await expect(
        sendTextMessage(meta, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "x" }),
      ).rejects.toMatchObject({ code: "channel_unavailable" });
      expect(await outs()).toHaveLength(0);
    });

    it("rechazo definitivo (4xx) → failed y se puede reintentar", async () => {
      const c = await openConversation();
      const { sendTextMessage, retryTextMessage } = await import("./send");
      const { ZernioSendError } = await import("./zernio");
      const rejecting = withProvider({
        sendText: async () => {
          throw new ZernioSendError(400, "131056", "Too many messages");
        },
      });
      await expect(
        sendTextMessage(rejecting, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "x" }),
      ).rejects.toMatchObject({ outcome: "rejected" });
      const [m] = await outs();
      expect(m).toMatchObject({ status: "failed", errorCode: "131056" });
      const ok = withProvider({ sendText: async () => ({ providerInternalId: "zmsg_ok", providerMessageId: "wamid.OK" }) });
      await expect(retryTextMessage(ok, { organizationId: ORG_A, messageId: m.id, sentByUserId: "u_vendedor" })).resolves.toMatchObject({
        status: "sent",
      });
    });

    it("primera respuesta: no cuenta envíos en cola/fallidos, y se revoca si WhatsApp rechaza después", async () => {
      const c = await openConversation();
      const { sendTextMessage } = await import("./send");
      const { ZernioSendError } = await import("./zernio");
      await expect(
        sendTextMessage(
          withProvider({ sendText: async () => { throw new ZernioSendError(400, "x", "rechazado"); } }),
          { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "a" },
        ),
      ).rejects.toThrow();
      // Un entrante posterior dispara la reconciliación: el fallido no cuenta.
      await deliver(msgEvent({ sentAt: new Date().toISOString() }));
      expect((await conv()).firstResponseSeconds).toBeNull();

      await sendTextMessage(withProvider({ sendText: async () => ({ providerInternalId: "zmsg_B", providerMessageId: "wamid.B" }) }), {
        organizationId: ORG_A,
        conversationId: c.id,
        sentByUserId: "u_vendedor",
        text: "b",
      });
      expect((await conv()).firstResponseSeconds).not.toBeNull();
      await deliver({
        id: `st_fail_${randomUUID()}`,
        event: "message.failed",
        message: { platformMessageId: "wamid.B", error: { code: 131047, message: "Re-engagement" } },
        account: { id: "zacc_1", platform: "whatsapp" },
      } as { id: string; event: string });
      expect((await conv()).firstResponseSeconds).toBeNull();
    });

    it("no leídos: dos envíos simultáneos con un entrante entre medio no lo borran", async () => {
      const c = await openConversation(2);
      const { sendTextMessage } = await import("./send");
      let arrived!: () => void;
      const inboundDone = new Promise<void>((r) => (arrived = r));
      let n = 0;
      const p = withProvider({
        sendText: async () => {
          const mine = ++n;
          if (mine === 1) {
            await deliver(msgEvent({ sentAt: new Date().toISOString() }));
            arrived();
          } else await inboundDone;
          return { providerInternalId: `zmsg_C${mine}`, providerMessageId: `wamid.C${mine}` };
        },
      });
      await Promise.all(
        ["uno", "dos"].map((text) => sendTextMessage(p, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text })),
      );
      expect((await conv()).unreadCount).toBe(1);
    });

    it("dos envíos del CRM nunca se fusionan en el mismo wamid", async () => {
      const c = await openConversation();
      const { sendTextMessage, linkSentMessage, SendConflictError } = await import("./send");
      await sendTextMessage(withProvider({ sendText: async () => ({ providerInternalId: "z1", providerMessageId: "wamid.ONE" }) }), {
        organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "a",
      });
      const { ZernioSendError } = await import("./zernio");
      const pending = await sendTextMessage(withProvider({ sendText: async () => { throw new ZernioSendError(0, "network", "x", "unknown"); } }), {
        organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "a",
      });
      await expect(
        linkSentMessage({ queuedId: pending.messageId, conversationId: c.id, organizationId: ORG_A, sentByUserId: "u_vendedor", providerMessageId: "wamid.ONE", status: "sent", sentAt: new Date(), readCutoffMessageId: null }),
      ).rejects.toBeInstanceOf(SendConflictError);
      expect(await outs()).toHaveLength(2);
    });

    it("un eco duplicado repara la conversación si quedó desactualizada", async () => {
      const c = await openConversation();
      const { sendTextMessage } = await import("./send");
      await sendTextMessage(withProvider({ sendText: async () => ({ providerInternalId: "zR", providerMessageId: "wamid.REPAIR" }) }), {
        organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "ok",
      });
      // Simula un estado viejo (p. ej. escrito antes de este arreglo).
      await db.update(s.conversations).set({ firstResponseSeconds: null, lastMessageAt: new Date(Date.now() - 3600_000) });
      await deliver(msgEvent({ direction: "outgoing", source: "cloud_api", wamid: "wamid.REPAIR", sentAt: new Date().toISOString() }));
      const after = await conv();
      expect(after.firstResponseSeconds).not.toBeNull();
      expect(after.lastMessageAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it("no leídos: un entrante que llega DURANTE el envío sigue sin leer", async () => {
      const c = await openConversation(2);
      expect(c.unreadCount).toBe(2);
      const { sendTextMessage } = await import("./send");
      const p = withProvider({
        sendText: async () => {
          await deliver(msgEvent({ sentAt: new Date().toISOString() })); // llega a mitad del envío
          return { providerInternalId: "zmsg_U", providerMessageId: "wamid.U" };
        },
      });
      await sendTextMessage(p, { organizationId: ORG_A, conversationId: c.id, sentByUserId: "u_vendedor", text: "va" });
      expect((await conv()).unreadCount).toBe(1);
    });
  });

  describe("webhook: allowlist de cuentas (falla cerrado)", () => {
    const SECRET = "whsec_test";
    const sign = async (body: string) => (await import("node:crypto")).createHmac("sha256", SECRET).update(body).digest("hex");
    async function post(payload: unknown, env: Record<string, string | undefined>) {
      const saved = { ...process.env };
      Object.assign(process.env, { ZERNIO_API_KEY: "k", ZERNIO_WEBHOOK_SECRET: SECRET, ...env });
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
      try {
        const { POST } = await import("@/app/api/webhooks/zernio/route");
        const body = JSON.stringify(payload);
        return await POST(new Request("https://x/api/webhooks/zernio", { method: "POST", body, headers: { "x-zernio-signature": await sign(body) } }));
      } finally {
        process.env = saved;
      }
    }
    const stored = async () => (await db.select().from(s.webhookEvents)).length;

    it("sin ZERNIO_ALLOWED_ACCOUNT_IDS → 503 y no guarda nada", async () => {
      const res = await post(msgEvent({ sentAt: "2026-09-18T10:00:00Z" }), { ZERNIO_ALLOWED_ACCOUNT_IDS: undefined });
      expect(res.status).toBe(503);
      expect(await stored()).toBe(0);
      expect((await post(msgEvent({ sentAt: "2026-09-18T10:00:00Z" }), { ZERNIO_ALLOWED_ACCOUNT_IDS: " " })).status).toBe(503);
    });

    it("otra cuenta, sin cuenta o con cuentas contradictorias → 200 y no guarda; la permitida sí", async () => {
      const env = { ZERNIO_ALLOWED_ACCOUNT_IDS: "zacc_1" };
      expect((await post(msgEvent({ account: "zacc_real", sentAt: "2026-09-18T10:00:00Z" }), env)).status).toBe(200);
      const noAccount = { ...msgEvent({ sentAt: "2026-09-18T10:00:00Z" }), account: undefined };
      expect((await post(noAccount, env)).status).toBe(200);
      const nested = msgEvent({ sentAt: "2026-09-18T10:00:00Z" });
      (nested.message as Record<string, unknown>).accountId = "zacc_real";
      expect((await post(nested, env)).status).toBe(200);
      expect(await post({ id: "evt_test", event: "webhook.test" }, env).then((r) => r.json())).toEqual({ ok: true, test: true });
      expect(await stored()).toBe(0);

      expect((await post(msgEvent({ sentAt: "2026-09-18T10:00:00Z" }), env)).status).toBe(200);
      expect(await stored()).toBe(1);
    });

    it("estado sin cuenta: se guarda solo si su wamid ya es de esta base", async () => {
      const env = { ZERNIO_ALLOWED_ACCOUNT_IDS: "zacc_1" };
      await deliver(msgEvent({ direction: "outgoing", source: "cloud_api", wamid: "wamid.KNOWN", sentAt: "2026-09-18T10:00:00Z" }));
      const before = await stored();
      const status = (wamid: string) => ({ id: `st_${randomUUID()}`, event: "message.failed", message: { platformMessageId: wamid, error: { code: 131047, message: "x" } } });
      expect((await post(status("wamid.AJENO"), env)).status).toBe(200);
      expect(await stored()).toBe(before);
      const known = status("wamid.KNOWN");
      expect((await post(known, env)).status).toBe(200);
      expect(await stored()).toBe(before + 1);
      await ingest.processWebhookEvent(provider, `zernio_${known.id}`);
      const [m] = await db.select().from(s.messages).where(eq(s.messages.providerMessageId, "wamid.KNOWN"));
      expect(m).toMatchObject({ status: "failed", errorCode: "131047" });
    });
  });

  describe("media: descarga a almacenamiento propio", () => {
    class MemoryStorage {
      objects = new Map<string, { body: Uint8Array; contentType: string }>();
      // Como S3 multipart: el objeto solo aparece si el stream termina bien.
      async putStream(key: string, body: import("node:stream").Readable, contentType: string) {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(chunk as Buffer);
        this.objects.set(key, { body: new Uint8Array(Buffer.concat(chunks)), contentType });
      }
      async exists(key: string) {
        return this.objects.has(key);
      }
      async signedGetUrl(key: string) {
        return `https://bucket/${key}?firmado`;
      }
    }
    const pdf = new TextEncoder().encode("%PDF-1.7 factura");
    const xml = new TextEncoder().encode("<cfdi:Comprobante/>");
    const sha = async (d: Uint8Array) => (await import("./media-keys")).sha256Base64(d);

    async function messageWithAttachments(hooks: import("./ingest").IngestHooks = {}) {
      const e = msgEvent({ sentAt: "2026-09-18T10:00:00Z" });
      (e.message as Record<string, unknown>).attachments = [
        { type: "file", url: "https://zernio.com/api/v1/whatsapp/media/1", payload: { id: "1", sha256: await sha(pdf), mimeType: "application/pdf", filename: "F-1.pdf" } },
        { type: "file", url: "https://zernio.com/api/v1/whatsapp/media/2", payload: { id: "2", sha256: await sha(xml), mimeType: "application/xml", filename: "F-1.xml" } },
      ];
      const id = `zernio_${e.id}`;
      await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: e.event, payload: e });
      await ingest.processWebhookEvent(provider, id, hooks);
      const [m] = await db.select().from(s.messages);
      return m;
    }
    const providerServing = (files: Record<string, Uint8Array | number>) =>
      ({
        ...provider,
        fetchMedia: async (url: string) => {
          const file = files[url.split("/").pop() ?? ""];
          return typeof file === "number" ? new Response("x", { status: file }) : new Response(new Blob([Buffer.from(file)]));
        },
      }) as import("./provider").MessagingProvider;

    it("la ingesta avisa (hook) solo por mensajes nuevos con adjuntos", async () => {
      const seen: string[] = [];
      const m = await messageWithAttachments({ onMediaMessage: (id) => void seen.push(id) });
      expect(seen).toEqual([m.id]);
      await deliver(msgEvent({ sentAt: "2026-09-18T11:00:00Z" })); // sin adjuntos
      expect(seen).toHaveLength(1);
    });

    it("descarga, verifica sha256, guarda en el bucket y anota storageKey/tamaño", async () => {
      const m = await messageWithAttachments();
      const storage = new MemoryStorage();
      const { downloadMessageMedia } = await import("./media");
      await expect(downloadMessageMedia(providerServing({ "1": pdf, "2": xml }), storage, m.id)).resolves.toEqual({ stored: 2, pending: 0 });
      const [after] = await db.select().from(s.messages);
      expect(after.attachments.map((a) => [a.storageKey, a.sizeBytes, a.downloadError])).toEqual([
        [`org/${ORG_A}/messages/${m.id}/0-F-1.pdf`, pdf.byteLength, undefined],
        [`org/${ORG_A}/messages/${m.id}/1-F-1.xml`, xml.byteLength, undefined],
      ]);
      expect(storage.objects.get(`org/${ORG_A}/messages/${m.id}/1-F-1.xml`)?.contentType).toBe("application/xml");
      // Idempotente: una segunda pasada no vuelve a descargar.
      await expect(downloadMessageMedia(providerServing({}), storage, m.id)).resolves.toEqual({ stored: 0, pending: 0 });
    });

    it("sha256 que no coincide o error del proveedor: se anota, se lanza, y un reintento posterior lo completa", async () => {
      const m = await messageWithAttachments();
      const storage = new MemoryStorage();
      const { downloadMessageMedia } = await import("./media");
      const corrupted = new TextEncoder().encode("%PDF truncado");
      await expect(downloadMessageMedia(providerServing({ "1": corrupted, "2": 500 }), storage, m.id)).rejects.toThrow(/sha256[\s\S]*adjunto 1: descarga respondió 500/);
      let [after] = await db.select().from(s.messages);
      expect(after.attachments.map((a) => [a.storageKey ?? null, a.downloadAttempts, Boolean(a.downloadError)])).toEqual([
        [null, 1, true],
        [null, 1, true],
      ]);
      expect(storage.objects.size).toBe(0);

      await downloadMessageMedia(providerServing({ "1": pdf, "2": xml }), storage, m.id);
      [after] = await db.select().from(s.messages);
      expect(after.attachments.every((a) => a.storageKey && !a.downloadError)).toBe(true);
      expect(after.attachments[0].downloadAttempts).toBe(2);
    });

    it("streaming: un archivo que excede el límite a media descarga se corta y no queda en el bucket", async () => {
      const m = await messageWithAttachments();
      const storage = new MemoryStorage();
      const { downloadMessageMedia } = await import("./media");
      let pulled = 0;
      // Sin Content-Length y en trozos de 1 KB: el límite se aplica al vuelo.
      const endless = {
        ...provider,
        fetchMedia: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                pulled++;
                controller.enqueue(new Uint8Array(1024));
              },
            }),
          ),
      } as import("./provider").MessagingProvider;
      await expect(downloadMessageMedia(endless, storage, m.id, { maxBytes: 8 * 1024 })).rejects.toThrow(/excede 8192 bytes/);
      expect(storage.objects.size).toBe(0);
      expect(pulled).toBeLessThan(40); // se dejó de leer en cuanto pasó el límite
      const [after] = await db.select().from(s.messages);
      expect(after.attachments.every((a) => !a.storageKey && a.downloadError)).toBe(true);
    });

    it("si el objeto ya estaba en el bucket (subida previa sin anotar), se reutiliza", async () => {
      const m = await messageWithAttachments();
      const storage = new MemoryStorage();
      storage.objects.set(`org/${ORG_A}/messages/${m.id}/0-F-1.pdf`, { body: pdf, contentType: "application/pdf" });
      storage.objects.set(`org/${ORG_A}/messages/${m.id}/1-F-1.xml`, { body: xml, contentType: "application/xml" });
      const { downloadMessageMedia } = await import("./media");
      await expect(downloadMessageMedia(providerServing({ "1": 503, "2": 503 }), storage, m.id)).resolves.toEqual({ stored: 2, pending: 0 });
    });
  });
});
