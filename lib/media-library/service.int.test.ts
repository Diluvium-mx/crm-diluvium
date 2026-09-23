// Biblioteca de media contra una base real (TEST_DATABASE_URL) y un bucket en memoria.
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ObjectStorage } from "@/lib/storage/s3";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

class MemoryStorage implements ObjectStorage {
  objects = new Map<string, { bytes: number; contentType: string }>();
  async putStream(key: string, body: Readable, contentType: string) {
    let bytes = 0;
    for await (const chunk of body) bytes += (chunk as Buffer).byteLength;
    this.objects.set(key, { bytes, contentType });
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
    return `https://bucket.test/${key}?firma=1`;
  }
}

describe.skipIf(!TEST_DATABASE_URL)("biblioteca de media", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let svc: typeof import("./service");
  let rules: typeof import("./rules");
  const org = "org_media_test";
  const otherOrg = "org_media_other";
  let storage: MemoryStorage;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    svc = await import("./service");
    rules = await import("./rules");
  });
  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, media_assets, organization cascade`);
    await db.insert(s.organization).values([
      { id: org, name: "A", slug: "a", createdAt: new Date() },
      { id: otherOrg, name: "B", slug: "b", createdAt: new Date() },
    ]);
    storage = new MemoryStorage();
  });
  afterAll(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, media_assets, organization cascade`);
  });

  const upload = (bytes: number, mime = "image/png", name = "tabla.png", declared = bytes) =>
    svc.storeUploadedAsset(storage, {
      organizationId: org,
      userId: null,
      title: "Tabla",
      fileName: name,
      mimeType: mime,
      declaredBytes: declared,
      body: Readable.from([Buffer.alloc(bytes, 1)]),
    });

  it("guarda el archivo en el bucket bajo la organización y lo lista solo para ella", async () => {
    const asset = await upload(1_000);
    expect(asset.kind).toBe("image");
    expect(asset.bytes).toBe(1_000);
    expect([...storage.objects.keys()][0]).toMatch(new RegExp(`^org/${org}/library/${asset.id}-tabla.png$`));
    expect(await svc.listMediaAssets(org)).toHaveLength(1);
    expect(await svc.listMediaAssets(otherOrg)).toHaveLength(0);
    expect(await svc.loadMediaAsset(otherOrg, asset.id)).toBeNull();
  });

  it("un archivo que miente en el tamaño declarado se corta y no deja objeto ni ficha", async () => {
    // Declara 1 KB pero manda 6 MB: WhatsApp lo rechazaría al enviarlo.
    await expect(upload(6 * 1024 * 1024, "image/png", "grande.png", 1_000)).rejects.toThrow(rules.MediaRejectedError);
    expect(storage.objects.size).toBe(0);
    expect(await svc.listMediaAssets(org)).toHaveLength(0);
  });

  it("rechaza tipos no permitidos y archivos vacíos sin tocar la base", async () => {
    await expect(upload(10, "image/gif", "a.gif")).rejects.toThrow(/no permitido/);
    await expect(upload(0)).rejects.toThrow(/vacío/);
    expect(await svc.listMediaAssets(org)).toHaveLength(0);
  });

  it("no se borra mientras un paso de workflow lo use; después sí (borrado lógico)", async () => {
    const asset = await upload(10);
    await db.insert(s.workflows).values({ id: "w1", organizationId: org, slug: "x", name: "X" });
    await db.insert(s.workflowSteps).values({
      id: "st1",
      organizationId: org,
      workflowId: "w1",
      position: 0,
      kind: "send_media",
      payload: { kind: "send_media", assetId: asset.id, title: "Tabla" },
    });
    await expect(svc.deleteMediaAsset(org, asset.id)).rejects.toThrow(svc.MediaInUseError);
    await db.delete(s.workflowSteps);
    await svc.deleteMediaAsset(org, asset.id);
    expect(await svc.listMediaAssets(org)).toHaveLength(0);
    // Otra organización no puede borrar ni renombrar lo ajeno.
    const again = await upload(10);
    await expect(svc.deleteMediaAsset(otherOrg, again.id)).rejects.toThrow(/no encontrado/);
    await expect(svc.renameMediaAsset(otherOrg, again.id, "Z")).rejects.toThrow(/no encontrado/);
  });

  it("la URL firmada sale del storage con el nombre del archivo", async () => {
    const asset = await upload(10);
    const row = await svc.loadMediaAsset(org, asset.id);
    expect(await svc.mediaAssetSignedUrl(storage, row!)).toContain(row!.storageKey);
  });
});
