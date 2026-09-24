// Envío de media desde la biblioteca (Fase D) contra una base real. Reusa el
// flujo de ingesta para abrir la conversación como en send-agent.int.test.ts.
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ObjectStorage } from "@/lib/storage/s3";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type P = import("./provider").MessagingProvider;

class MemoryStorage implements ObjectStorage {
  objects = new Map<string, number>();
  async putStream(key: string, body: Readable) {
    let n = 0;
    for await (const c of body) n += (c as Buffer).byteLength;
    this.objects.set(key, n);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async head(key: string) {
    return this.objects.has(key) ? { bytes: this.objects.get(key)!, contentType: null } : null;
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async getBytes(): Promise<Uint8Array> {
    throw new Error("no usado");
  }
  async signedGetUrl(key: string) {
    return `https://bucket.test/${key}?X-Amz-Signature=abc`;
  }
}

describe.skipIf(!TEST_DATABASE_URL)("sendMediaMessage", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let ingest: typeof import("./ingest");
  let send: typeof import("./send");
  let media: typeof import("@/lib/media-library/service");
  let eq: typeof import("drizzle-orm").eq;
  let provider: P;
  const ORG = "org_media_send";
  const OTHER = "org_media_send_other";
  let storage: MemoryStorage;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("./ingest");
    send = await import("./send");
    media = await import("@/lib/media-library/service");
    ({ eq } = await import("drizzle-orm"));
    const z = await import("./zernio");
    provider = new z.ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate media_assets, webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "org", createdAt: new Date() },
      { id: OTHER, name: "Otra", slug: "otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_a",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_1",
      displayName: "Diluvium",
    });
    storage = new MemoryStorage();
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  async function inbound(sentAt = new Date()) {
    seq++;
    const phone = "5216682410002";
    const payload = {
      id: `evt_${seq}_${randomUUID()}`,
      event: "message.received",
      timestamp: sentAt.toISOString(),
      message: {
        id: `zmsg_${seq}`,
        conversationId: `zconv_${phone}`,
        platform: "whatsapp",
        platformMessageId: `wamid.${seq}.${randomUUID()}`,
        direction: "incoming",
        text: `mensaje ${seq}`,
        attachments: [],
        sender: { id: phone, name: "Cliente", phoneNumber: phone },
        sentAt: sentAt.toISOString(),
      },
      conversation: { id: `zconv_${phone}`, participantId: phone, participantName: "Cliente" },
      account: { id: "zacc_1", platform: "whatsapp" },
    };
    const id = `zernio_${payload.id}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: payload.event, payload });
    await ingest.processWebhookEvent(provider, id);
    return (await db.select().from(s.conversations))[0];
  }

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
      sendMedia: async () => {
        throw new Error("no se esperaba sendMedia");
      },
      ...overrides,
    }) as P;

  const asset = (org = ORG) =>
    media.storeUploadedAsset(storage, {
      organizationId: org,
      userId: null,
      title: "Tabla",
      fileName: "tabla.png",
      mimeType: "image/png",
      declaredBytes: 3,
      body: Readable.from([Buffer.from("abc")]),
    });
  const outs = () => db.select().from(s.messages).where(eq(s.messages.direction, "out"));

  it("manda el archivo por URL firmada con pie, guarda la burbuja con storageKey y enlaza el wamid", async () => {
    const c = await inbound();
    const a = await asset();
    const calls: unknown[] = [];
    const out = await send.sendMediaMessage(
      withProvider({
        sendMedia: async (input) => {
          calls.push(input);
          return { providerInternalId: "z1", providerMessageId: "wamid.MEDIA1" };
        },
      }),
      storage,
      { organizationId: ORG, conversationId: c.id, assetId: a.id, caption: "Tabla de tamaños", sentByUserId: "u_vendedor" },
    );
    expect(out.status).toBe("sent");
    expect(calls[0]).toMatchObject({
      providerAccountId: "zacc_1",
      kind: "image",
      caption: "Tabla de tamaños",
      url: expect.stringContaining("X-Amz-Signature"),
      idempotencyKey: out.messageId,
    });
    const [m] = await outs();
    expect(m).toMatchObject({ type: "image", body: "Tabla de tamaños", source: "crm", status: "sent", providerMessageId: "wamid.MEDIA1" });
    expect(m.attachments[0]).toMatchObject({ type: "image", mimeType: "image/png", fileName: "tabla.png" });
    expect(m.attachments[0].storageKey).toContain(`org/${ORG}/library/`);
  });

  it("fuera de la ventana de 24 h no sale nada (WhatsApp lo rechazaría y el cliente no vería el archivo)", async () => {
    const c = await inbound(new Date(Date.now() - 25 * 3_600_000));
    const a = await asset();
    await expect(
      send.sendMediaMessage(withProvider({}), storage, { organizationId: ORG, conversationId: c.id, assetId: a.id }),
    ).rejects.toMatchObject({ code: "window_closed" });
    expect(await outs()).toHaveLength(0);
  });

  it("un archivo de OTRA organización no se envía ni deja fila", async () => {
    const c = await inbound();
    const ajeno = await asset(OTHER);
    await expect(
      send.sendMediaMessage(withProvider({}), storage, { organizationId: ORG, conversationId: c.id, assetId: ajeno.id }),
    ).rejects.toMatchObject({ code: "media_not_found" });
    expect(await outs()).toHaveLength(0);
  });

  it("como agente (ai_agent) no descuenta no leídos ni cuenta como primera respuesta; sin pie no manda caption", async () => {
    const c = await inbound();
    const a = await asset();
    let captured: { caption?: string } | null = null;
    await send.sendMediaMessage(
      withProvider({
        sendMedia: async (input) => {
          captured = input;
          return { providerInternalId: "z2", providerMessageId: "wamid.MEDIA2" };
        },
      }),
      storage,
      { organizationId: ORG, conversationId: c.id, assetId: a.id, source: "ai_agent" },
    );
    expect(captured!.caption).toBeUndefined();
    const [m] = await outs();
    expect(m).toMatchObject({ source: "ai_agent", sentByUserId: null, body: null });
    const after = (await db.select().from(s.conversations))[0];
    expect(after.unreadCount).toBe(1);
    expect(after.firstResponseSeconds).toBeNull();
  });

  it("si el proveedor rechaza (4xx), la burbuja queda failed con el código y se puede ver en la UI", async () => {
    const c = await inbound();
    const a = await asset();
    const { ZernioSendError } = await import("./zernio");
    await expect(
      send.sendMediaMessage(
        withProvider({
          sendMedia: async () => {
            throw new ZernioSendError(400, "media_invalida", "formato no soportado", "rejected");
          },
        }),
        storage,
        { organizationId: ORG, conversationId: c.id, assetId: a.id },
      ),
    ).rejects.toMatchObject({ code: "media_invalida" });
    expect((await outs())[0]).toMatchObject({ status: "failed", errorCode: "media_invalida" });
  });
});
