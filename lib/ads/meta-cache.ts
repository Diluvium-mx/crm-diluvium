// Caché por anuncio (meta_ads) de la API de Marketing de Meta. Se consulta al
// llegar el primer clic de un anuncio y se refresca si tiene más de un día (los
// nombres cambian). Si Meta falla, se guarda el error y se reintenta con
// espera; la UI muestra lo que haya. Guarda la información completa (columnas
// + respuestas crudas) y el link de origen de la miniatura; la miniatura misma
// la copia el worker (lib/ads/thumbnail.ts). El video NO se descarga.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaAds } from "@/lib/db/schema";
import { adsManagerUrl, fetchMetaAd, metaApiConfigFromEnv, retryDelayMs, storyUrl, type MetaApiConfig } from "./meta-api";

/** Nombres "frescos" por un día: un clic nuevo de un anuncio consultado hace menos no vuelve a llamar a Meta. */
export const META_FRESH_MS = 24 * 3_600_000;

export type RefreshResult =
  | { status: "actualizado"; needsThumbnail: boolean }
  | { status: "fresco" }
  | { status: "no_existe" }
  | { status: "error"; error: string; retryInMs: number };

export async function refreshMetaAd(
  organizationId: string,
  adId: string,
  { config, force = false, now = new Date() }: { config?: MetaApiConfig; force?: boolean; now?: Date } = {},
): Promise<RefreshResult> {
  const where = and(eq(metaAds.organizationId, organizationId), eq(metaAds.adId, adId));
  const [row] = await db.select().from(metaAds).where(where).limit(1);
  if (!row) return { status: "no_existe" };
  if (!force && row.fetchedAt && !row.fetchError && now.getTime() - row.fetchedAt.getTime() < META_FRESH_MS) return { status: "fresco" };
  // Tras un error se respeta la espera (el barrido y los clics nuevos no martillan a Meta).
  if (!force && row.nextFetchAt && row.nextFetchAt > now) {
    return { status: "error", error: row.fetchError ?? "en espera", retryInMs: row.nextFetchAt.getTime() - now.getTime() };
  }

  try {
    const info = await fetchMetaAd(adId, config ?? metaApiConfigFromEnv());
    // Link de origen de la miniatura: la del creativo (320 px) o la portada del
    // video o la imagen. Un link NUEVO reinicia los intentos (el anterior caducó).
    const thumbSource = info.thumbnailUrl ?? info.videoPictureUrl ?? info.imageUrl;
    await db
      .update(metaAds)
      .set({
        adName: info.adName,
        adsetId: info.adsetId,
        adsetName: info.adsetName,
        campaignId: info.campaignId,
        campaignName: info.campaignName,
        accountId: info.accountId,
        effectiveStatus: info.effectiveStatus,
        creativeId: info.creativeId,
        creativeTitle: info.title,
        creativeBody: info.body,
        creativeObjectType: info.objectType,
        ctaType: info.ctaType,
        linkUrl: info.linkUrl,
        videoId: info.videoId,
        videoTitle: info.videoTitle,
        videoLengthSeconds: info.videoLengthSeconds,
        storyId: info.storyId,
        adsManagerUrl: adsManagerUrl(adId, info.accountId),
        ...(storyUrl(info.storyId) ? { postUrl: storyUrl(info.storyId) } : {}),
        metaRaw: info.raw,
        ...(thumbSource && thumbSource !== row.thumbnailUrl ? { thumbnailUrl: thumbSource, thumbnailAttempts: 0 } : {}),
        fetchedAt: now,
        fetchError: null,
        fetchAttempts: 0,
        nextFetchAt: null,
      })
      .where(where);
    // Los datos del video son opcionales (pueden requerir permiso sobre la página).
    if (info.videoError) console.warn(`[anuncios] ${adId}: sin datos del video (${info.videoError})`);
    return { status: "actualizado", needsThumbnail: !row.thumbnailKey && Boolean(thumbSource) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryInMs = retryDelayMs(error, row.fetchAttempts);
    await db
      .update(metaAds)
      .set({
        fetchError: message.slice(0, 500),
        fetchAttempts: row.fetchAttempts + 1,
        nextFetchAt: new Date(now.getTime() + retryInMs),
      })
      .where(where);
    return { status: "error", error: message, retryInMs };
  }
}
