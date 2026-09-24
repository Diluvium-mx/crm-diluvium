// Media de los anuncios (imagen, video, miniatura) → bucket propio.
//
// Los links de la ficha (image_url / video_url / thumbnail_url) son del CDN de
// Meta, firmados, y caducan en HORAS: se copian en cuanto llega el webhook. Si
// la descarga falla, se reintenta sin frenar el mensaje (el mensaje ya está
// guardado; esto corre en el worker). Un link caducado se abandona y la tarjeta
// usa el creativo que devuelve la API de Marketing (también copiado aquí).
import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { isIP } from "node:net";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adClicks, metaAds, type AdMediaItem } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";

export const AD_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Intentos por archivo ante fallos de red o 5xx. */
export const AD_MEDIA_MAX_ATTEMPTS = 8;
/** Un 4xx (403/404/410 = link caducado o inválido) se abandona antes. */
const AD_MEDIA_MAX_4XX = 3;
/** Pasado este plazo desde el clic, el link ya caducó: no se insiste. */
export const AD_MEDIA_GIVE_UP_HOURS = 48;

export class AdMediaError extends Error {
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

function limitStream(maxBytes: number) {
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      if (size > maxBytes) return callback(new AdMediaError(`archivo de más de ${maxBytes} bytes`));
      callback(null, chunk);
    },
  });
  return { stream, size: () => size };
}

/** Descarga un link y lo sube al bucket en streaming. Devuelve tipo y tamaño. */
export async function copyToBucket(
  storage: ObjectStorage,
  key: string,
  url: string,
  { fetchImpl = fetch, maxBytes = AD_MEDIA_MAX_BYTES }: { fetchImpl?: typeof fetch; maxBytes?: number } = {},
): Promise<{ mimeType: string; sizeBytes: number }> {
  const target = safeMediaUrl(url);
  if (!target) throw new AdMediaError("link de media no permitido (solo https a un dominio público)", 400);
  let res: Response;
  try {
    res = await fetchImpl(target, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new AdMediaError(`sin respuesta: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new AdMediaError(`descarga respondió ${res.status}`, res.status);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new AdMediaError(`archivo de ${declared} bytes excede ${maxBytes}`, 413);
  }
  const mimeType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  const source = res.body ? Readable.fromWeb(res.body as WebReadableStream<Uint8Array>) : Readable.from([]);
  const limiter = limitStream(maxBytes);
  source.on("error", (error) => limiter.stream.destroy(error));
  limiter.stream.on("error", () => source.destroy());
  try {
    await storage.putStream(key, source.pipe(limiter.stream), mimeType);
  } finally {
    source.destroy();
  }
  if (limiter.size() === 0) throw new AdMediaError("archivo vacío", 204);
  return { mimeType, sizeBytes: limiter.size() };
}

/** ¿Este archivo aún se puede intentar? */
export function mediaPending(item: AdMediaItem): boolean {
  return !item.storageKey && !item.givenUpAt;
}

/** Aplica el resultado de un intento a un archivo (puro, para testear). */
export function afterAttempt(
  item: AdMediaItem,
  outcome: { ok: true; storageKey: string; mimeType: string; sizeBytes: number } | { ok: false; error: AdMediaError },
  clickedAt: Date,
  now = new Date(),
): AdMediaItem {
  const attempts = (item.attempts ?? 0) + 1;
  if (outcome.ok) {
    const next: AdMediaItem = {
      ...item,
      storageKey: outcome.storageKey,
      mimeType: outcome.mimeType,
      sizeBytes: outcome.sizeBytes,
      downloadedAt: now.toISOString(),
      attempts,
    };
    delete next.error;
    return next;
  }
  const status = outcome.error.httpStatus;
  const expired = now.getTime() - clickedAt.getTime() > AD_MEDIA_GIVE_UP_HOURS * 3_600_000;
  const clientError = status >= 400 && status < 500;
  const giveUp = expired || attempts >= AD_MEDIA_MAX_ATTEMPTS || (clientError && attempts >= AD_MEDIA_MAX_4XX);
  return { ...item, attempts, error: outcome.error.message.slice(0, 300), ...(giveUp ? { givenUpAt: now.toISOString() } : {}) };
}

type Target = { table: "click"; id: string } | { table: "ad"; organizationId: string; adId: string };

function keyFor(organizationId: string, target: Target, role: AdMediaItem["role"]): string {
  return target.table === "click"
    ? `org/${organizationId}/ads/clicks/${target.id}/${role}`
    : `org/${organizationId}/ads/meta/${target.adId}/${role}`;
}

/**
 * Intenta copiar los archivos pendientes de un clic o de un anuncio. Anota el
 * resultado por archivo (con la fila bloqueada para no pisar otro intento).
 * Devuelve cuántos quedan pendientes; lanza si alguno falló y se puede
 * reintentar (el job de BullMQ reintenta con espera).
 */
async function downloadPending(
  storage: ObjectStorage,
  organizationId: string,
  target: Target,
  items: AdMediaItem[],
  clickedAt: Date,
  fetchImpl?: typeof fetch,
): Promise<{ stored: number; pending: number; retryable: string[] }> {
  const results = new Map<number, AdMediaItem>();
  for (const [index, item] of items.entries()) {
    if (!mediaPending(item)) continue;
    // Llave determinista (sin extensión: el tipo queda en el objeto): reintentar
    // sobrescribe el mismo objeto, no duplica.
    const key = keyFor(organizationId, target, item.role);
    try {
      const { mimeType, sizeBytes } = await copyToBucket(storage, key, item.url, { fetchImpl });
      results.set(index, afterAttempt(item, { ok: true, storageKey: key, mimeType, sizeBytes }, clickedAt));
    } catch (error) {
      const err = error instanceof AdMediaError ? error : new AdMediaError(error instanceof Error ? error.message : String(error));
      results.set(index, afterAttempt(item, { ok: false, error: err }, clickedAt));
    }
  }
  if (results.size === 0) return { stored: items.filter((i) => i.storageKey).length, pending: 0, retryable: [] };

  let merged: AdMediaItem[] = [];
  await db.transaction(async (tx) => {
    if (target.table === "click") {
      const [row] = await tx.select({ media: adClicks.media }).from(adClicks).where(eq(adClicks.id, target.id)).for("update");
      if (!row) return;
      merged = row.media.map((current, i) => (current.storageKey ? current : (results.get(i) ?? current)));
      await tx.update(adClicks).set({ media: merged }).where(eq(adClicks.id, target.id));
    } else {
      const where = and(eq(metaAds.organizationId, target.organizationId), eq(metaAds.adId, target.adId));
      const [row] = await tx.select({ media: metaAds.creativeMedia }).from(metaAds).where(where).for("update");
      if (!row) return;
      merged = row.media.map((current, i) =>
        current.storageKey || current.url !== items[i]?.url ? current : (results.get(i) ?? current),
      );
      await tx.update(metaAds).set({ creativeMedia: merged }).where(where);
    }
  });
  return {
    stored: merged.filter((i) => i.storageKey).length,
    pending: merged.filter(mediaPending).length,
    retryable: [...results.values()].filter((i) => !i.storageKey && !i.givenUpAt).map((i) => `${i.role}: ${i.error}`),
  };
}

/**
 * Identidad del ARCHIVO en el CDN de Meta: la ruta, sin la firma de la query
 * (la firma cambia en cada entrega; la ruta nombra el archivo). Dos links con
 * la misma ruta son el mismo archivo.
 */
export function mediaAssetKey(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^[^.]+\./, "")}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Otro clic del MISMO anuncio ya copió ESE archivo: se reusa su copia en vez de
 * descargar otra vez el mismo video. Solo si es el mismo archivo de Meta (misma
 * ruta): un anuncio dinámico sirve imágenes distintas bajo el mismo id, y cada
 * cliente debe ver el creativo que él vio. Devuelve la media ya completada.
 */
async function reuseSiblingMedia(clickId: string, organizationId: string, adId: string): Promise<AdMediaItem[] | null> {
  const siblings = await db
    .select({ media: adClicks.media })
    .from(adClicks)
    .where(
      and(
        eq(adClicks.organizationId, organizationId),
        eq(adClicks.adId, adId),
        ne(adClicks.id, clickId),
        sql`exists (select 1 from jsonb_array_elements(${adClicks.media}) m where m->>'storageKey' is not null)`,
      ),
    )
    .orderBy(desc(adClicks.clickedAt))
    .limit(5);
  const storedByAsset = new Map<string, AdMediaItem>();
  for (const s of siblings) {
    for (const m of s.media) {
      const asset = mediaAssetKey(m.url);
      if (m.storageKey && asset && !storedByAsset.has(`${m.role}|${asset}`)) storedByAsset.set(`${m.role}|${asset}`, m);
    }
  }
  if (storedByAsset.size === 0) return null;
  let merged: AdMediaItem[] | null = null;
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ media: adClicks.media }).from(adClicks).where(eq(adClicks.id, clickId)).for("update");
    if (!row) return;
    let changed = false;
    merged = row.media.map((m) => {
      const asset = mediaAssetKey(m.url);
      const sibling = asset ? storedByAsset.get(`${m.role}|${asset}`) : undefined;
      if (!mediaPending(m) || !sibling?.storageKey) return m;
      changed = true;
      const reused: AdMediaItem = {
        ...m,
        storageKey: sibling.storageKey,
        mimeType: sibling.mimeType,
        sizeBytes: sibling.sizeBytes,
        downloadedAt: new Date().toISOString(),
      };
      delete reused.error;
      return reused;
    });
    if (changed) await tx.update(adClicks).set({ media: merged }).where(eq(adClicks.id, clickId));
  });
  return merged;
}

/** Media de un clic (ficha del webhook). Lanza si hay algo que reintentar. */
export async function downloadClickMedia(storage: ObjectStorage, clickId: string, fetchImpl?: typeof fetch) {
  const [click] = await db
    .select({ organizationId: adClicks.organizationId, adId: adClicks.adId, media: adClicks.media, clickedAt: adClicks.clickedAt })
    .from(adClicks)
    .where(eq(adClicks.id, clickId))
    .limit(1);
  if (!click) return { stored: 0, pending: 0 };
  const media = (click.adId && click.media.some(mediaPending) && (await reuseSiblingMedia(clickId, click.organizationId, click.adId))) || click.media;
  const r = await downloadPending(storage, click.organizationId, { table: "click", id: clickId }, media, click.clickedAt, fetchImpl);
  if (r.retryable.length) throw new AdMediaError(`media del anuncio pendiente (${r.retryable.join("; ")})`);
  return { stored: r.stored, pending: r.pending };
}

/** Media del creativo (API de Marketing). Lanza si hay algo que reintentar. */
export async function downloadCreativeMedia(storage: ObjectStorage, organizationId: string, adId: string, fetchImpl?: typeof fetch) {
  const where = and(eq(metaAds.organizationId, organizationId), eq(metaAds.adId, adId));
  const [ad] = await db.select({ media: metaAds.creativeMedia, fetchedAt: metaAds.fetchedAt }).from(metaAds).where(where).limit(1);
  if (!ad) return { stored: 0, pending: 0 };
  // Los links del creativo se piden en el momento: su "hora" es la de la consulta.
  const r = await downloadPending(storage, organizationId, { table: "ad", organizationId, adId }, ad.media, ad.fetchedAt ?? new Date(), fetchImpl);
  if (r.retryable.length) throw new AdMediaError(`media del creativo pendiente (${r.retryable.join("; ")})`);
  return { stored: r.stored, pending: r.pending };
}
