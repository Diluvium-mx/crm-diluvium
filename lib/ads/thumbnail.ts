// UNA miniatura chica por anuncio (decisión del dueño, 25-sep-2026): nada de
// videos ni archivos por clic. Se guarda un JPEG de máximo 320 px en el bucket
// (org/{org}/ads/meta/{adId}/miniatura.jpg), para la tarjeta del chat y la
// página del anuncio. Fuentes, en orden: el link de la ficha del primer clic
// (thumbnail_url en video, image_url en imagen; caduca en horas) y el del
// creativo que da la API de Marketing (se renueva cada vez que se consulta).
// Nunca frena un mensaje: corre en el worker y reintenta con espera.
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { isIP } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaAds } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";

/** Lado mayor de la miniatura (px). */
export const THUMB_MAX_SIDE = 320;
/** Tope de bytes de la imagen de origen (una miniatura o una imagen de anuncio caben de sobra). */
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;
/** Tope de píxeles de la imagen decodificada (una imagen de anuncio es ~1080×1920). */
const SOURCE_MAX_PIXELS = 40_000_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Intentos con el link del creativo antes de dejarlo (se reinicia si Meta da otro link). */
export const THUMB_MAX_ATTEMPTS = 6;

export class ThumbnailError extends Error {
  constructor(
    message: string,
    readonly httpStatus = 0,
  ) {
    super(message);
  }
}

/** Solo https a un host con nombre (nunca IP literal, localhost ni red interna). */
export function safeMediaUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || isIP(host) || host === "localhost" || !host.includes(".")) return null;
  if (host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localhost")) return null;
  return url;
}

async function download(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const target = safeMediaUrl(url);
  if (!target) throw new ThumbnailError("link no permitido (solo https a un dominio público)", 400);
  let res: Response;
  try {
    res = await fetchImpl(target, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new ThumbnailError(`sin respuesta: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ThumbnailError(`descarga respondió ${res.status}`, res.status);
  }
  if (Number(res.headers.get("content-length") ?? 0) > SOURCE_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new ThumbnailError("imagen demasiado grande", 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const body = res.body ? Readable.fromWeb(res.body as WebReadableStream<Uint8Array>) : Readable.from([]);
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.byteLength;
    if (size > SOURCE_MAX_BYTES) {
      body.destroy();
      throw new ThumbnailError("imagen demasiado grande", 413);
    }
    chunks.push(buf);
  }
  if (size === 0) throw new ThumbnailError("imagen vacía", 204);
  return Buffer.concat(chunks);
}

/** Reduce a JPEG con el lado mayor ≤ THUMB_MAX_SIDE (nunca agranda). */
export async function toThumbnailJpeg(source: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  let image;
  try {
    image = await loadImage(source);
  } catch (error) {
    throw new ThumbnailError(`no es una imagen legible: ${error instanceof Error ? error.message : String(error)}`, 415);
  }
  if (!(image.width > 0 && image.height > 0) || image.width * image.height > SOURCE_MAX_PIXELS) {
    throw new ThumbnailError(`dimensiones inválidas (${image.width}×${image.height})`, 415);
  }
  const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // un PNG con transparencia no queda negro en JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.encode("jpeg", 80);
}

export function thumbnailKeyFor(organizationId: string, adId: string): string {
  return `org/${organizationId}/ads/meta/${adId}/miniatura.jpg`;
}

export type ThumbResult = "guardada" | "ya_existe" | "sin_anuncio" | "sin_link";

/**
 * Guarda la miniatura del anuncio si aún no tiene. `url` = link a probar (de la
 * ficha); sin él, el del creativo guardado en meta_ads. Un fallo con el link
 * del creativo cuenta un intento (el barrido deja de insistir al tope); un
 * fallo con el link de la ficha solo se anota (es de un solo uso: caduca).
 * Lanza si falló (el job reintenta con espera).
 */
export async function storeAdThumbnail(
  storage: ObjectStorage,
  organizationId: string,
  adId: string,
  url?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThumbResult> {
  const where = and(eq(metaAds.organizationId, organizationId), eq(metaAds.adId, adId));
  const [row] = await db
    .select({ thumbnailKey: metaAds.thumbnailKey, thumbnailUrl: metaAds.thumbnailUrl })
    .from(metaAds)
    .where(where)
    .limit(1);
  if (!row) return "sin_anuncio";
  if (row.thumbnailKey) return "ya_existe";
  const source = url ?? row.thumbnailUrl;
  if (!source) return "sin_link";
  const fromCreative = !url;
  try {
    const jpeg = await toThumbnailJpeg(await download(source, fetchImpl));
    const key = thumbnailKeyFor(organizationId, adId);
    await storage.putStream(key, Readable.from([jpeg]), "image/jpeg");
    // Solo la primera gana (dos clics a la vez escriben la misma llave).
    await db
      .update(metaAds)
      .set({ thumbnailKey: key, thumbnailStoredAt: new Date(), thumbnailError: null })
      .where(and(where, sql`${metaAds.thumbnailKey} is null`));
    return "guardada";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await db
      .update(metaAds)
      .set({
        thumbnailError: `${fromCreative ? "creativo" : "ficha"}: ${message}`,
        ...(fromCreative ? { thumbnailAttempts: sql`${metaAds.thumbnailAttempts} + 1` } : {}),
      })
      .where(where);
    throw error instanceof ThumbnailError ? error : new ThumbnailError(message);
  }
}
