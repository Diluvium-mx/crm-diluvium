// Miniatura de PDF contra Postgres REAL y un bucket en memoria: se genera una
// vez, guarda páginas, no toca otros adjuntos y un PDF roto no tumba nada.
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

// PDF mínimo de 2 páginas (la 1ª con un cuadro azul).
const PDF = new TextEncoder().encode(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
0 0 1 rg 20 20 160 160 re f
endstream endobj
5 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`);

class MemoryStorage {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async putStream(key: string, body: Readable, contentType: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    this.objects.set(key, { body: new Uint8Array(Buffer.concat(chunks)), contentType });
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async signedGetUrl(key: string) {
    return `https://bucket/${key}`;
  }
  async getBytes(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error("no existe");
    return object.body;
  }
}

describe.skipIf(!TEST_DATABASE_URL)("miniaturas de PDF (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let thumbs: typeof import("./thumbnails");
  let eq: typeof import("drizzle-orm").eq;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    thumbs = await import("./thumbnails");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values({ id: "org_t", name: "T", slug: "t", createdAt: new Date() });
    await db.insert(s.channels).values({ id: "ch_t", organizationId: "org_t", type: "whatsapp", provider: "zernio", providerAccountId: "zacc_t", displayName: "T" });
    await db.insert(s.contacts).values({ id: "c_t", organizationId: "org_t", firstName: "C" });
    await db.insert(s.conversations).values({ id: "conv_t", organizationId: "org_t", contactId: "c_t", channelId: "ch_t" });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function message(attachments: import("@/lib/db/schema").MessageAttachment[]) {
    await db.insert(s.messages).values({
      id: "m_t",
      organizationId: "org_t",
      conversationId: "conv_t",
      direction: "in",
      source: "contact",
      type: "document",
      status: "received",
      attachments,
    });
  }
  const read = async () => (await db.select().from(s.messages).where(eq(s.messages.id, "m_t")))[0].attachments;

  it("genera la miniatura y las páginas UNA vez; ignora imágenes y XML", async () => {
    const storage = new MemoryStorage();
    storage.objects.set("k/f.pdf", { body: PDF, contentType: "application/pdf" });
    await message([
      { type: "document", url: "u1", mimeType: "application/pdf", fileName: "F-1.pdf", storageKey: "k/f.pdf" },
      { type: "document", url: "u2", mimeType: "application/xml", fileName: "F-1.xml", storageKey: "k/f.xml" },
      { type: "image", url: "u3", mimeType: "image/jpeg", storageKey: "k/i.jpg" },
    ]);
    expect(await thumbs.generateMessageThumbnails(storage, "m_t")).toBe(1);
    const [pdf, xml, img] = await read();
    expect(pdf).toMatchObject({ thumbnailKey: "k/f.pdf.thumb.png", pageCount: 2, thumbnailAttempts: 1 });
    expect(storage.objects.get("k/f.pdf.thumb.png")?.contentType).toBe("image/png");
    expect(xml.thumbnailKey).toBeUndefined();
    expect(img.thumbnailKey).toBeUndefined();
    // Segunda corrida: nada que hacer.
    expect(await thumbs.generateMessageThumbnails(storage, "m_t")).toBe(0);
  });

  it("un PDF roto no lanza: anota el error y deja de intentar tras 3 veces", async () => {
    const storage = new MemoryStorage();
    storage.objects.set("k/roto.pdf", { body: new TextEncoder().encode("no es un pdf"), contentType: "application/pdf" });
    await message([{ type: "document", url: "u", mimeType: "application/pdf", fileName: "roto.pdf", storageKey: "k/roto.pdf" }]);
    for (let i = 0; i < 4; i++) await thumbs.generateMessageThumbnails(storage, "m_t");
    const [att] = await read();
    expect(att.thumbnailKey).toBeUndefined();
    expect(att.thumbnailError).toBeTruthy();
    expect(att.thumbnailAttempts).toBe(thumbs.THUMBNAIL_MAX_ATTEMPTS);
  });

  it("sin descargar aún (sin storageKey) no se intenta", async () => {
    await message([{ type: "document", url: "u", mimeType: "application/pdf", fileName: "F.pdf" }]);
    expect(await thumbs.generateMessageThumbnails(new MemoryStorage(), "m_t")).toBe(0);
    expect((await read())[0].thumbnailAttempts).toBeUndefined();
  });

  it("dos generaciones a la vez del mismo PDF → un solo render (reclamo atómico)", async () => {
    const storage = new MemoryStorage();
    storage.objects.set("k/f.pdf", { body: PDF, contentType: "application/pdf" });
    let reads = 0;
    const counting = Object.assign(Object.create(storage) as MemoryStorage, {
      getBytes: async (key: string) => {
        reads++;
        return storage.getBytes(key);
      },
    });
    await message([{ type: "document", url: "u", mimeType: "application/pdf", fileName: "F.pdf", storageKey: "k/f.pdf" }]);
    const results = await Promise.all([
      thumbs.generateMessageThumbnails(counting, "m_t"),
      thumbs.generateMessageThumbnails(counting, "m_t"),
    ]);
    expect(results.sort()).toEqual([0, 1]);
    expect(reads).toBe(1);
    const [att] = await read();
    expect(att.thumbnailAttempts).toBe(1);
    expect(att.thumbnailClaimedAt).toBeUndefined();
  });

  it("una página con proporción extrema produce una miniatura acotada (sin lienzo gigante)", async () => {
    const tall = new TextEncoder().encode(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 200000]>>endobj
trailer<</Root 1 0 R>>
%%EOF`);
    const storage = new MemoryStorage();
    storage.objects.set("k/alto.pdf", { body: tall, contentType: "application/pdf" });
    await message([{ type: "document", url: "u", mimeType: "application/pdf", fileName: "alto.pdf", storageKey: "k/alto.pdf" }]);
    expect(await thumbs.generateMessageThumbnails(storage, "m_t")).toBe(1);
    const png = storage.objects.get("k/alto.pdf.thumb.png")?.body;
    expect(png).toBeDefined();
    // Alto del PNG (bytes 20-23 del encabezado IHDR, big-endian).
    const height = new DataView(png!.buffer, png!.byteOffset).getUint32(20);
    expect(height).toBeLessThanOrEqual(480);
  });

  it("una miniatura pesada (> 64 KiB por stdout) llega completa del proceso hijo", async () => {
    // Página con una imagen de ruido 320×480 sin comprimir: el PNG resultante
    // pesa cientos de KB y no cabe en un solo buffer del pipe.
    const w = 320;
    const h = 480;
    const pixels = (await import("node:crypto")).randomBytes(w * h * 3);
    const head = Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
        `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
        `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]/Resources<</XObject<</Im 5 0 R>>>>/Contents 4 0 R>>endobj\n` +
        `4 0 obj<</Length 28>>stream\nq ${w} 0 0 ${h} 0 0 cm /Im Do Q\nendstream endobj\n` +
        `5 0 obj<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Length ${pixels.length}>>stream\n`,
    );
    const tail = Buffer.from(`\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);
    const storage = new MemoryStorage();
    storage.objects.set("k/ruido.pdf", { body: new Uint8Array(Buffer.concat([head, pixels, tail])), contentType: "application/pdf" });
    await message([{ type: "document", url: "u", mimeType: "application/pdf", fileName: "ruido.pdf", storageKey: "k/ruido.pdf" }]);
    expect(await thumbs.generateMessageThumbnails(storage, "m_t")).toBe(1);
    const png = storage.objects.get("k/ruido.pdf.thumb.png")!.body;
    expect(png.byteLength).toBeGreaterThan(64 * 1024);
    // Termina con el bloque IEND: el PNG no llegó truncado.
    expect(Buffer.from(png.subarray(-8, -4)).toString("latin1")).toBe("IEND");
  });
});
