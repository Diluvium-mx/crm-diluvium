// Copia de respaldo de la Biblioteca en Zernio (envío blindado, 22-oct-2026; docs/fase-d-diseno.md
// §12). Cada archivo vive en nuestro bucket (Railway) Y en el almacenamiento de Zernio, así un
// problema del bucket (como las llaves que Railway cambió el 21-oct) no deja sin imagen al
// cliente: lib/messaging/media-source.ts manda desde la copia si el bucket no entrega.
// Zernio borra lo subido a los 7 días: el worker la renueva a los 5 (ZERNIO_COPY_REFRESH_MS). Si
// el bucket falla al renovarla, la copia vieja sigue sirviendo hasta su día 6.5.
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaAssets } from "@/lib/db/schema";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { ZERNIO_COPY_REFRESH_MS } from "@/lib/messaging/media-source";
import type { ObjectStorage } from "@/lib/storage/s3";
import { safeErrorMessage } from "@/lib/log/safe-error";

// Topes de WhatsApp: video 16 MB, imagen 5 MB. Un documento más grande no lleva copia (el bucket
// sigue siendo su único origen); se sube en memoria, de uno en uno.
export const ZERNIO_COPY_MAX_BYTES = 16 * 1024 * 1024;
// Por vuelta (cada 10 min): la Biblioteca completa (22 archivos, 72 MB al 22-oct) en ~20 min.
const PER_RUN = 12;

// Tipos que acepta Zernio para subir (docs.zernio.com/media); los demás no llevan copia.
const ZERNIO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "application/pdf",
]);

/** Tipo con el que se sube a Zernio, o null si no lo acepta. (pura) */
export function zernioContentType(mimeType: string): string | null {
  const type = mimeType.toLowerCase().split(";")[0].trim();
  const normalized = type === "image/jpg" ? "image/jpeg" : type;
  return ZERNIO_TYPES.has(normalized) ? normalized : null;
}

/** Sube o renueva las copias que faltan o están por vencer. Nunca lanza. */
export async function refreshZernioCopies(deps: { provider: MessagingProvider; storage: ObjectStorage; now?: Date }): Promise<{ copied: number; failed: number }> {
  const upload = deps.provider.uploadMedia?.bind(deps.provider);
  if (!upload) return { copied: 0, failed: 0 };
  const now = deps.now ?? new Date();
  const due = await db
    .select({ id: mediaAssets.id, storageKey: mediaAssets.storageKey, fileName: mediaAssets.fileName, mimeType: mediaAssets.mimeType })
    .from(mediaAssets)
    .where(
      and(
        isNull(mediaAssets.deletedAt),
        lte(mediaAssets.bytes, ZERNIO_COPY_MAX_BYTES),
        // Solo tipos que Zernio acepta: uno que no, nunca tendrá copia y no debe tapar la fila.
        inArray(sql`lower(trim(split_part(${mediaAssets.mimeType}, ';', 1)))`, [...ZERNIO_TYPES, "image/jpg"]),
        or(isNull(mediaAssets.zernioCopyAt), lt(mediaAssets.zernioCopyAt, new Date(now.getTime() - ZERNIO_COPY_REFRESH_MS))),
      ),
    )
    // Primero las que nunca tuvieron copia, luego las más viejas.
    .orderBy(sql`${mediaAssets.zernioCopyAt} asc nulls first`)
    .limit(PER_RUN);
  let copied = 0;
  let failed = 0;
  for (const asset of due) {
    const contentType = zernioContentType(asset.mimeType);
    if (!contentType) continue;
    try {
      const body = await deps.storage.getBytes(asset.storageKey, ZERNIO_COPY_MAX_BYTES);
      const { publicUrl } = await upload({ body, fileName: asset.fileName, contentType });
      await db.update(mediaAssets).set({ zernioCopyUrl: publicUrl, zernioCopyAt: now }).where(eq(mediaAssets.id, asset.id));
      copied++;
    } catch (error) {
      failed++;
      console.error(`[biblioteca] copia en Zernio de ${asset.id} falló (la anterior sigue si no ha vencido): ${safeErrorMessage(error)}`);
    }
  }
  return { copied, failed };
}
