// Envío blindado (22-oct-2026, docs/fase-d-diseno.md §12): de dónde sale un archivo de la Biblioteca.
//
// Por qué existe: el 21-oct Railway cambió las llaves de los buckets (incidente de seguridad) y el
// CRM siguió firmando con la vieja hasta el siguiente despliegue. WhatsApp descargaba el enlace,
// el bucket respondía 403 y la imagen fallaba minutos después (131053): 58 archivos no le llegaron
// a 53 clientes y nada lo frenó. Ahora, ANTES de mandar, se prueba el enlace igual que lo haría
// WhatsApp; si no responde, sale desde la copia en Zernio (otro proveedor, lib/media-library/
// zernio-copy.ts); si tampoco, no se manda (la corrida espera y reintenta, executor.ts).
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaAssets } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";
import { probeUrl, type ProbeResult } from "@/lib/net/probe-url";
import { mediaAssetSignedUrl } from "@/lib/media-library/service";

export type MediaOrigin = "bucket" | "zernio";

/** Llave en `messages.metadata` con el origen del archivo enviado. */
export const MEDIA_ORIGIN_META = "origenArchivo";

/** Zernio borra la copia a los 7 días: se usa hasta los 6.5 (el worker la renueva a los 5). */
export const ZERNIO_COPY_VALID_MS = 6.5 * 86_400_000;
export const ZERNIO_COPY_REFRESH_MS = 5 * 86_400_000;

// Vida de la URL firmada que descarga el proveedor: suficiente para reintentos
// del proveedor, corta para que no circule.
export const MEDIA_SEND_URL_SECONDS = 15 * 60;

export type MediaAssetSource = {
  storageKey: string;
  fileName: string;
  mimeType: string;
  zernioCopyUrl: string | null;
  zernioCopyAt: Date | null;
};

export type PickedSource = { url: string; origin: MediaOrigin } | { url: null; reasons: string[] };

/** ¿La copia de Zernio todavía existe? (pura) */
export function zernioCopyUsable(asset: Pick<MediaAssetSource, "zernioCopyUrl" | "zernioCopyAt">, now: Date): boolean {
  return !!asset.zernioCopyUrl && !!asset.zernioCopyAt && now.getTime() - asset.zernioCopyAt.getTime() < ZERNIO_COPY_VALID_MS;
}

/**
 * Primer origen que entrega el archivo: `prefer` (por defecto el bucket) y luego el otro. Un
 * rescate (lib/workflows/media-rescue.ts) pide primero el que NO falló. Nunca lanza: sin
 * origen, devuelve los motivos de cada uno.
 */
export async function pickMediaSource(input: {
  storage: ObjectStorage;
  asset: MediaAssetSource;
  now: Date;
  prefer?: MediaOrigin;
  fetchImpl?: typeof fetch;
}): Promise<PickedSource> {
  const order: MediaOrigin[] = input.prefer === "zernio" ? ["zernio", "bucket"] : ["bucket", "zernio"];
  const reasons: string[] = [];
  for (const origin of order) {
    const tried = origin === "bucket" ? await tryBucket(input.storage, input.asset) : await tryZernio(input.asset, input.now, input.fetchImpl);
    if (tried.url) return { url: tried.url, origin };
    if (tried.reason) reasons.push(tried.reason);
  }
  return { url: null, reasons };
}

async function tryBucket(storage: ObjectStorage, asset: MediaAssetSource): Promise<{ url: string | null; reason?: string }> {
  let url: string;
  try {
    url = await mediaAssetSignedUrl(storage, asset, MEDIA_SEND_URL_SECONDS);
  } catch (error) {
    return { url: null, reason: `bucket: no se pudo firmar (${error instanceof Error ? error.message : String(error)})` };
  }
  // Sin prueba (dobles de prueba), el enlace firmado se da por bueno, como antes.
  const probe: ProbeResult = storage.probeSignedUrl ? await storage.probeSignedUrl(url) : { ok: true };
  return probe.ok ? { url } : { url: null, reason: `bucket: ${probe.reason}` };
}

async function tryZernio(asset: Pick<MediaAssetSource, "zernioCopyUrl" | "zernioCopyAt">, now: Date, fetchImpl?: typeof fetch): Promise<{ url: string | null; reason?: string }> {
  const url = asset.zernioCopyUrl;
  if (!url || !zernioCopyUsable(asset, now)) return { url: null, reason: "copia en Zernio: no hay o ya venció" };
  const probe = await probeUrl(url, fetchImpl);
  return probe.ok ? { url } : { url: null, reason: `copia en Zernio: ${probe.reason}` };
}

/**
 * Adjunto del chat que es un archivo de la Biblioteca (Multimedia): su copia en Zernio, ya
 * probada, o null (no es de la Biblioteca, no hay copia vigente o no responde).
 */
export async function libraryCopyFor(organizationId: string, storageKey: string, now: Date, fetchImpl?: typeof fetch): Promise<string | null> {
  const [asset] = await db
    .select({ zernioCopyUrl: mediaAssets.zernioCopyUrl, zernioCopyAt: mediaAssets.zernioCopyAt })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.organizationId, organizationId), eq(mediaAssets.storageKey, storageKey), isNull(mediaAssets.deletedAt)))
    .limit(1);
  if (!asset) return null;
  const tried = await tryZernio(asset, now, fetchImpl);
  return tried.url;
}
