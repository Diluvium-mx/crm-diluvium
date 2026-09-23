// Biblioteca de media (Fase D): guardar, listar, renombrar y borrar archivos
// de la organización. El archivo vive en el bucket privado; aquí la ficha
// (`media_assets`). Sin "server-only": lo usan las Server Actions, la ruta de
// subida y (después) el ejecutor de workflows en el worker.
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaAssets, workflowSteps } from "@/lib/db/schema/automation";
import type { ObjectStorage } from "@/lib/storage/s3";
import { assetStorageKey, MEDIA_LIMITS, MediaRejectedError, validateUpload } from "./rules";

export type MediaAssetView = {
  id: string;
  kind: "image" | "video" | "document";
  title: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
};

export const ASSET_URL_SECONDS = 300;

function toView(row: typeof mediaAssets.$inferSelect): MediaAssetView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    bytes: row.bytes,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMediaAssets(organizationId: string): Promise<MediaAssetView[]> {
  const rows = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.organizationId, organizationId), isNull(mediaAssets.deletedAt)))
    .orderBy(desc(mediaAssets.createdAt));
  return rows.map(toView);
}

// Cuenta bytes y calcula el sha256 al vuelo; corta en cuanto pasa el límite,
// así el bucket nunca recibe un archivo mayor de lo que WhatsApp aceptaría.
function countingStream(maxBytes: number) {
  const hash = createHash("sha256");
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.byteLength;
      if (size > maxBytes) return cb(new MediaRejectedError("size", `El archivo pesa más de ${Math.round(maxBytes / 1024 / 1024)} MB.`));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  return { stream, size: () => size, sha256: () => hash.digest("hex") };
}

/**
 * Guarda un archivo subido: valida lo declarado, lo sube en streaming al bucket
 * contando bytes (si excede, aborta y no queda objeto) y da de alta la ficha.
 * Si la ficha falla, borra el objeto para no dejar basura.
 */
export async function storeUploadedAsset(
  storage: ObjectStorage,
  input: {
    organizationId: string;
    userId: string | null;
    title: string;
    fileName: string;
    mimeType: string;
    declaredBytes: number;
    body: Readable;
  },
): Promise<MediaAssetView> {
  const { kind, fileName } = validateUpload({ fileName: input.fileName, mimeType: input.mimeType, bytes: input.declaredBytes });
  const title = input.title.trim().slice(0, 120) || fileName;
  const id = crypto.randomUUID();
  const key = assetStorageKey(input.organizationId, id, fileName);
  const counter = countingStream(MEDIA_LIMITS[kind].maxBytes);
  input.body.on("error", (e) => counter.stream.destroy(e));
  counter.stream.on("error", () => input.body.destroy());
  try {
    await storage.putStream(key, input.body.pipe(counter.stream), input.mimeType);
  } finally {
    input.body.destroy();
  }
  if (counter.size() === 0) {
    await storage.deleteObject(key).catch(() => undefined);
    throw new MediaRejectedError("empty", "El archivo está vacío.");
  }
  try {
    const [row] = await db
      .insert(mediaAssets)
      .values({
        id,
        organizationId: input.organizationId,
        kind,
        title,
        fileName,
        mimeType: input.mimeType.toLowerCase().split(";")[0].trim(),
        bytes: counter.size(),
        sha256: counter.sha256(),
        storageKey: key,
        createdByUserId: input.userId,
      })
      .returning();
    return toView(row);
  } catch (error) {
    await storage.deleteObject(key).catch(() => undefined);
    throw error;
  }
}

export async function renameMediaAsset(organizationId: string, assetId: string, title: string): Promise<void> {
  const clean = title.trim().slice(0, 120);
  if (!clean) throw new MediaRejectedError("name", "El nombre está vacío.");
  const rows = await db
    .update(mediaAssets)
    .set({ title: clean })
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.organizationId, organizationId), isNull(mediaAssets.deletedAt)))
    .returning({ id: mediaAssets.id });
  if (rows.length === 0) throw new Error("Archivo no encontrado en esta organización.");
}

export class MediaInUseError extends Error {}

// Borrado lógico. Se niega si algún paso de un workflow lo usa: si no, ese
// workflow mandaría un archivo roto al cliente (o fallaría en silencio).
export async function deleteMediaAsset(organizationId: string, assetId: string, now = new Date()): Promise<void> {
  const steps = await db
    .select({ payload: workflowSteps.payload })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.organizationId, organizationId), eq(workflowSteps.kind, "send_media")));
  const uses = steps.filter((s) => s.payload.kind === "send_media" && s.payload.assetId === assetId).length;
  if (uses > 0) throw new MediaInUseError(`Este archivo lo usan ${uses} paso(s) de workflows. Quítalo de ahí primero.`);
  const rows = await db
    .update(mediaAssets)
    .set({ deletedAt: now })
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.organizationId, organizationId), isNull(mediaAssets.deletedAt)))
    .returning({ id: mediaAssets.id });
  if (rows.length === 0) throw new Error("Archivo no encontrado en esta organización.");
}

// Ficha viva de un archivo de la organización (para enviarlo o verlo).
export async function loadMediaAsset(organizationId: string, assetId: string) {
  const [row] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.organizationId, organizationId), isNull(mediaAssets.deletedAt)))
    .limit(1);
  return row ?? null;
}

// URL firmada para VER el archivo (vista previa) o para que el proveedor lo
// descargue al enviarlo. Corta vida: la firma se genera en cada uso.
export async function mediaAssetSignedUrl(
  storage: ObjectStorage,
  asset: { storageKey: string; fileName: string },
  seconds = ASSET_URL_SECONDS,
): Promise<string> {
  return storage.signedGetUrl(asset.storageKey, seconds, asset.fileName, "inline");
}
