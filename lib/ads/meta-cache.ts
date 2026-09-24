// Caché por anuncio (meta_ads) de la API de Marketing de Meta. Se consulta al
// llegar el primer clic de un anuncio y se refresca si tiene más de un día (los
// nombres cambian). Si Meta falla, se guarda el error y se reintenta con
// espera; la UI muestra lo que haya.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adClicks, metaAds, type AdMediaItem } from "@/lib/db/schema";
import { fetchMetaAd, metaApiConfigFromEnv, retryDelayMs, type MetaAdInfo, type MetaApiConfig } from "./meta-api";

/** Nombres "frescos" por un día: un clic nuevo de un anuncio consultado hace menos no vuelve a llamar a Meta. */
export const META_FRESH_MS = 24 * 3_600_000;

/**
 * Lista de media del creativo: conserva lo ya copiado al bucket (por rol) y
 * toma los links nuevos para lo que falta. El video del creativo solo se pide
 * si ningún clic de este anuncio trajo ya su video (se copia de la ficha).
 */
export function mergeCreativeMedia(current: AdMediaItem[], info: MetaAdInfo, clickHasVideo: boolean): AdMediaItem[] {
  const fresh: AdMediaItem[] = [];
  if (info.imageUrl) fresh.push({ role: "image", url: info.imageUrl, attempts: 0 });
  const thumb = info.thumbnailUrl ?? info.videoPictureUrl;
  if (thumb) fresh.push({ role: "thumbnail", url: thumb, attempts: 0 });
  if (info.videoSourceUrl && !clickHasVideo) fresh.push({ role: "video", url: info.videoSourceUrl, attempts: 0 });
  const stored = new Map(current.filter((m) => m.storageKey).map((m) => [m.role, m]));
  const out = fresh.map((m) => stored.get(m.role) ?? m);
  // Lo ya copiado que Meta ya no devuelve también se conserva.
  for (const [role, m] of stored) if (!out.some((x) => x.role === role)) out.push(m);
  return out;
}

export type RefreshResult = "actualizado" | "fresco" | "no_existe" | { error: string; retryInMs: number };

export async function refreshMetaAd(
  organizationId: string,
  adId: string,
  { config, force = false, now = new Date() }: { config?: MetaApiConfig; force?: boolean; now?: Date } = {},
): Promise<RefreshResult> {
  const where = and(eq(metaAds.organizationId, organizationId), eq(metaAds.adId, adId));
  const [row] = await db.select().from(metaAds).where(where).limit(1);
  if (!row) return "no_existe";
  if (!force && row.fetchedAt && !row.fetchError && now.getTime() - row.fetchedAt.getTime() < META_FRESH_MS) return "fresco";
  // Tras un error se respeta la espera (el barrido y los clics nuevos no martillan a Meta).
  if (!force && row.nextFetchAt && row.nextFetchAt > now) return { error: row.fetchError ?? "en espera", retryInMs: row.nextFetchAt.getTime() - now.getTime() };

  try {
    const info = await fetchMetaAd(adId, config ?? metaApiConfigFromEnv());
    const [video] = await db
      .select({ id: adClicks.id })
      .from(adClicks)
      .where(
        and(
          eq(adClicks.organizationId, organizationId),
          eq(adClicks.adId, adId),
          sql`exists (select 1 from jsonb_array_elements(${adClicks.media}) m where m->>'role' = 'video' and m->>'storageKey' is not null)`,
        ),
      )
      .limit(1);
    // La media se fusiona con la fila BLOQUEADA: una descarga que terminó
    // mientras se consultaba a Meta no se pierde.
    await db.transaction(async (tx) => {
      const [locked] = await tx.select({ media: metaAds.creativeMedia }).from(metaAds).where(where).for("update");
      if (!locked) return;
      await tx
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
          videoId: info.videoId,
          storyId: info.storyId,
          creativeMedia: mergeCreativeMedia(locked.media, info, Boolean(video)),
          fetchedAt: now,
          fetchError: null,
          fetchAttempts: 0,
          nextFetchAt: null,
        })
        .where(where);
    });
    // El video del creativo es opcional (puede requerir permiso sobre la
    // página): no marca el anuncio como fallido; queda la miniatura.
    if (info.videoError) console.warn(`[anuncios] ${adId}: sin video del creativo (${info.videoError})`);
    return "actualizado";
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
    return { error: message, retryInMs };
  }
}
