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

  describe("media: descarga a almacenamiento propio", () => {
    class MemoryStorage {
      objects = new Map<string, { body: Uint8Array; contentType: string }>();
      async put(key: string, body: Uint8Array, contentType: string) {
        this.objects.set(key, { body, contentType });
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

    it("si el objeto ya estaba en el bucket (subida previa sin anotar), se reutiliza", async () => {
      const m = await messageWithAttachments();
      const storage = new MemoryStorage();
      await storage.put(`org/${ORG_A}/messages/${m.id}/0-F-1.pdf`, pdf, "application/pdf");
      await storage.put(`org/${ORG_A}/messages/${m.id}/1-F-1.xml`, xml, "application/xml");
      const { downloadMessageMedia } = await import("./media");
      await expect(downloadMessageMedia(providerServing({ "1": 503, "2": 503 }), storage, m.id)).resolves.toEqual({ stored: 2, pending: 0 });
    });
  });
});
