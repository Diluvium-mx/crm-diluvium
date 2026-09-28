// Adjuntos del chat (28-sep-2026) contra una base real: subida con el tipo
// real por bytes, cola en orden con el pie solo en el primero, envío una sola
// vez por archivo, errores guardados y limpieza de lo no enviado. El proveedor y
// el bucket son dobles.
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ObjectStorage } from "@/lib/storage/s3";
import type { MessagingProvider, SendMediaInput } from "@/lib/messaging/provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "secreto-solo-para-tests-de-adjuntos-0123456789";

class MemoryStorage implements ObjectStorage {
  objects = new Map<string, { bytes: number; contentType: string; lastModified: Date }>();
  async putStream(key: string, body: Readable, contentType: string) {
    let n = 0;
    for await (const c of body) n += (c as Buffer).byteLength;
    this.objects.set(key, { bytes: n, contentType, lastModified: new Date() });
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { bytes: o.bytes, contentType: o.contentType } : null;
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
  async *listObjects(prefix: string) {
    for (const [key, o] of this.objects) if (key.startsWith(prefix)) yield { key, lastModified: o.lastModified };
  }
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from("%PDF-1.7\nprueba");
const XML = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante Total="100.00"/>');
const HEVC_MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12), Buffer.from("....hvc1....")]);

describe.skipIf(!TEST_DATABASE_URL)("adjuntos del chat", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let up: typeof import("./upload");
  let send: typeof import("@/lib/messaging/send");
  let maint: typeof import("./maintenance");
  let token: typeof import("./token");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_adj";
  const OTHER = "org_adj_otra";
  const CONV = "conv_adj";
  let storage: MemoryStorage;
  let sent: SendMediaInput[];
  let rejectFileName: string | null;

  const provider = {
    name: "zernio",
    verifyWebhook: () => true,
    readEnvelope: () => ({ eventId: "x", event: "x" }),
    normalize: () => ({ kind: "ignored", eventId: "x", event: "x", reason: "test" }),
    fetchMedia: async () => new Response(null),
    sendText: async () => {
      throw new Error("no se esperaba sendText");
    },
    sendMedia: async (input: SendMediaInput) => {
      if (input.fileName === rejectFileName) {
        const { SendFailedError } = await import("@/lib/messaging/provider");
        throw new SendFailedError("131053", "Media upload error", "rejected");
      }
      sent.push(input);
      return { providerInternalId: `z${sent.length}`, providerMessageId: `wamid.adj.${sent.length}.${randomUUID()}` };
    },
    sendTemplate: async () => {
      throw new Error("no se esperaba sendTemplate");
    },
    listTemplates: async () => [],
    createTemplate: async () => ({ providerTemplateId: null, status: "PENDING" }),
  } satisfies MessagingProvider;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    up = await import("./upload");
    send = await import("@/lib/messaging/send");
    maint = await import("./maintenance");
    token = await import("./token");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    sent = [];
    rejectFileName = null;
    storage = new MemoryStorage();
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "org-adj", createdAt: new Date() },
      { id: OTHER, name: "Otra", slug: "otra-adj", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_v", name: "Paty", email: "p@adj.mx" });
    await db.insert(s.channels).values({ id: "ch_adj", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc", displayName: "Diluvium" });
    await db.insert(s.contacts).values({ id: "c_adj", organizationId: ORG, firstName: "Ana", phoneE164: "+526681112299", stage: "prospecto" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: "c_adj",
      channelId: "ch_adj",
      providerConversationId: "zconv",
      windowExpiresAt: new Date(Date.now() + 20 * 3_600_000),
      lastMessageAt: new Date(Date.now() - 60_000),
    });
    // Un entrante sin contestar: el primer envío del vendedor cuenta como primera respuesta.
    await db.insert(s.messages).values({ id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "hola", status: "delivered", sentAt: new Date(Date.now() - 60_000), providerMessageId: `wamid.in.${randomUUID()}` });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const store = (fileName: string, body: Buffer, org = ORG, conversationId = CONV) =>
    up.storeChatUpload(storage, { organizationId: org, userId: "u_v", conversationId, fileName, declaredBytes: body.byteLength, body: Readable.from([body]) });
  const toSend = (tok: string) => {
    const u = token.verifyChatUpload(tok, { organizationId: ORG, userId: "u_v", conversationId: CONV });
    return { storageKey: u.storageKey, kind: u.kind, mime: u.mime, fileName: u.fileName, bytes: u.bytes };
  };
  const outs = () => db.select().from(s.messages).where(eq(s.messages.direction, "out"));

  it("subida: tipo real por bytes, carpeta propia por organización y XML guardado como text/plain", async () => {
    const pdf = await store("Cotización.pdf", PDF);
    const xml = await store("FACTURA-A1.xml", XML);
    expect(pdf).toMatchObject({ kind: "document", mime: "application/pdf", bytes: PDF.byteLength, fileName: "Cotización.pdf" });
    expect(xml).toMatchObject({ kind: "document", mime: "text/plain", fileName: "FACTURA-A1.xml" });
    const keys = [...storage.objects.keys()];
    expect(keys.every((k) => k.startsWith(`org/${ORG}/chat/`))).toBe(true);
    expect(storage.objects.get(toSend(xml.token).storageKey)?.contentType).toBe("text/plain");
  });

  it("subida: rechaza lo disfrazado, lo no aceptado y el video HEVC sin dejar objeto; conversación ajena tampoco", async () => {
    await expect(store("foto.jpg", PDF)).rejects.toBeInstanceOf(up.ChatUploadRejectedError);
    await expect(store("anim.gif", Buffer.from("GIF89a"))).rejects.toThrow("(.gif)");
    await expect(store("iphone.mp4", HEVC_MP4)).rejects.toThrow("HEVC");
    await expect(store("a.pdf", PDF, OTHER)).rejects.toThrow("Conversación no encontrada");
    expect(storage.objects.size).toBe(0);
  });

  it("envío: una burbuja por archivo en orden, pie SOLO en el primero; salen una vez y cuentan como vendedor", async () => {
    const files = [await store("uno.jpg", JPEG), await store("dos.pdf", PDF), await store("tres.xml", XML)].map((u) => toSend(u.token));
    const ids = await send.queueChatUploads(provider, { organizationId: ORG, conversationId: CONV, sentByUserId: "u_v", files, captions: ["Aquí van", null, null] });
    const queued = await outs();
    expect(queued.map((m) => [m.id, m.status, m.body, m.type])).toEqual(
      expect.arrayContaining([
        [ids[0], "queued", "Aquí van", "image"],
        [ids[1], "queued", null, "document"],
        [ids[2], "queued", null, "document"],
      ]),
    );
    // Mandar dos veces los mismos archivos (doble clic) no crea más burbujas.
    await send.queueChatUploads(provider, { organizationId: ORG, conversationId: CONV, sentByUserId: "u_v", files, captions: ["Aquí van", null, null] });
    expect(await outs()).toHaveLength(3);

    for (const id of ids) await send.sendQueuedChatUpload(provider, storage, { organizationId: ORG, messageId: id });
    // Un reintento del job no vuelve a mandar nada.
    for (const id of ids) expect(await send.sendQueuedChatUpload(provider, storage, { organizationId: ORG, messageId: id })).toBeNull();
    expect(sent.map((x) => [x.kind, x.fileName, x.caption ?? null])).toEqual([
      ["image", "uno.jpg", "Aquí van"],
      ["document", "dos.pdf", null],
      ["document", "tres.xml", null],
    ]);
    expect(sent[0].url).toContain("X-Amz-Signature");
    expect(sent.map((x) => x.idempotencyKey)).toEqual(ids);
    const rows = await outs();
    expect(rows.every((m) => m.status === "sent" && m.source === "crm" && m.sentByUserId === "u_v")).toBe(true);
    // En la burbuja queda la ruta interna, no la URL firmada.
    expect(rows.find((m) => m.id === ids[2])?.attachments[0]).toMatchObject({ mimeType: "text/plain", fileName: "tres.xml", url: `/api/media/${ids[2]}/0` });
    const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, CONV));
    expect(conv.firstResponseSeconds).not.toBeNull();
  });

  it("un archivo que WhatsApp rechaza guarda su motivo y los demás siguen saliendo", async () => {
    const files = [await store("uno.jpg", JPEG), await store("malo.pdf", PDF), await store("tres.jpg", JPEG)].map((u) => toSend(u.token));
    const ids = await send.queueChatUploads(provider, { organizationId: ORG, conversationId: CONV, sentByUserId: "u_v", files, captions: [null, null, null] });
    rejectFileName = "malo.pdf";
    for (const id of ids) await send.sendQueuedChatUpload(provider, storage, { organizationId: ORG, messageId: id }).catch(() => undefined);
    const byId = new Map((await outs()).map((m) => [m.id, m]));
    expect(byId.get(ids[1])).toMatchObject({ status: "failed", errorCode: "131053" });
    expect(byId.get(ids[0])?.status).toBe("sent");
    expect(byId.get(ids[2])?.status).toBe("sent");
  });

  it("ventana de 24 h cerrada: no se deja ninguna burbuja", async () => {
    await db.update(s.conversations).set({ windowExpiresAt: new Date(Date.now() - 1000) }).where(eq(s.conversations.id, CONV));
    const files = [toSend((await store("uno.jpg", JPEG)).token)];
    await expect(send.queueChatUploads(provider, { organizationId: ORG, conversationId: CONV, sentByUserId: "u_v", files, captions: [null] })).rejects.toMatchObject({ code: "window_closed" });
    expect(await outs()).toHaveLength(0);
  });

  it("barrido: lo pendiente sin job se agrupa por conversación y en orden", async () => {
    const files = [await store("uno.jpg", JPEG), await store("dos.jpg", JPEG)].map((u) => toSend(u.token));
    const past = new Date(Date.now() - 60_000);
    const ids = await send.queueChatUploads(provider, { organizationId: ORG, conversationId: CONV, sentByUserId: "u_v", files, captions: [null, null], now: past });
    expect(await maint.pendingChatUploadJobs()).toEqual([{ organizationId: ORG, conversationId: CONV, messageIds: ids }]);
    await send.sendQueuedChatUpload(provider, storage, { organizationId: ORG, messageId: ids[0] });
    expect(await maint.pendingChatUploadJobs()).toEqual([{ organizationId: ORG, conversationId: CONV, messageIds: [ids[1]] }]);
  });

  it("limpieza: borra lo subido y NUNCA enviado de más de 24 h; lo enviado y lo reciente se quedan", async () => {
    const day = 86_400_000;
    const old = new Date(Date.now() - 2 * day);
    const usado = await up.storeChatUpload(storage, { organizationId: ORG, userId: "u_v", conversationId: CONV, fileName: "usado.jpg", declaredBytes: JPEG.byteLength, body: Readable.from([JPEG]), now: old });
    const huerfano = await up.storeChatUpload(storage, { organizationId: ORG, userId: "u_v", conversationId: CONV, fileName: "huerfano.jpg", declaredBytes: JPEG.byteLength, body: Readable.from([JPEG]), now: old });
    const reciente = await store("reciente.jpg", JPEG);
    const keyOf = (t: string) => token.verifyChatUpload(t, { organizationId: ORG, userId: "u_v", conversationId: CONV, now: old.getTime() + 1000 }).storageKey;
    for (const t of [usado.token, huerfano.token]) storage.objects.get(keyOf(t))!.lastModified = old;
    const u = token.verifyChatUpload(usado.token, { organizationId: ORG, userId: "u_v", conversationId: CONV, now: old.getTime() + 1000 });
    await send.queueChatUploads(provider, { organizationId: ORG, conversationId: CONV, sentByUserId: "u_v", files: [{ storageKey: u.storageKey, kind: u.kind, mime: u.mime, fileName: u.fileName, bytes: u.bytes }], captions: [null], now: new Date(old.getTime() + 60_000) });
    expect(await maint.cleanupUnsentChatUploads(storage)).toBe(1);
    expect(storage.objects.has(keyOf(huerfano.token))).toBe(false);
    expect(storage.objects.has(u.storageKey)).toBe(true);
    expect(storage.objects.has(toSend(reciente.token).storageKey)).toBe(true);
  });
});
