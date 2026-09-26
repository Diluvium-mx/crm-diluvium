// Worker de anuncios (corre dentro del servicio `worker`). Nada de esto frena
// un mensaje: el mensaje ya está guardado cuando llega aquí.
// - thumb: UNA miniatura chica por anuncio al bucket (del link de la ficha, que
//   caduca en horas, o del creativo de la API). Sin videos ni archivos por clic.
// - meta: nombres de campaña/conjunto/anuncio, creativo y datos del video.
// - status: estado Activa/Pausada de todos los anuncios, cada hora (lib/ads/meta-status.ts).
// - fallback: mensaje que parecía de anuncio sin ficha → primer clic guardado
//   por Zernio en la conversación;
// - record: red de seguridad si el clic no se registró en la ingesta.
// El barrido (cada minuto) re-encola lo pendiente desde la base.
import { Worker } from "bullmq";
import { and, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaAds } from "@/lib/db/schema";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { redisConnection } from "@/lib/queue/inbound";
import { ADS_QUEUE, enqueueAdsJob, scheduleAdStatusRefresh, type AdsJob } from "@/lib/queue/ads";
import type { ObjectStorage } from "@/lib/storage/s3";
import {
  attributeFromProviderConversation,
  messagesPendingFallback,
  messagesWithUnrecordedReferral,
  recordClickFromMessage,
  type FallbackJob,
  type RecordedClick,
} from "./attribution";
import { refreshMetaAd } from "./meta-cache";
import { STATUS_REFRESH_MS } from "./ad-status";
import { refreshAdStatuses } from "./meta-status";
import { storeAdThumbnail, THUMB_MAX_ATTEMPTS, ThumbnailError } from "./thumbnail";

/** Encola lo que sigue a un clic nuevo: la miniatura del anuncio (si aún no tiene) y los nombres de Meta. */
export async function enqueueAfterClick(click: RecordedClick): Promise<void> {
  if (!click.adId) return;
  if (click.thumbUrl) {
    const [ad] = await db
      .select({ thumbnailKey: metaAds.thumbnailKey })
      .from(metaAds)
      .where(and(eq(metaAds.organizationId, click.organizationId), eq(metaAds.adId, click.adId)))
      .limit(1);
    if (!ad?.thumbnailKey) await enqueueAdsJob({ kind: "thumb", organizationId: click.organizationId, adId: click.adId, url: click.thumbUrl });
  }
  await enqueueAdsJob({ kind: "meta", organizationId: click.organizationId, adId: click.adId });
}

/** Ganchos de la ingesta (lib/messaging/ingest.ts → IngestHooks). */
export const adsIngestHooks = {
  onAdClick: enqueueAfterClick,
  // 30 s de gracia: Zernio guarda el clic en la conversación al procesar el
  // mismo webhook; consultar al instante podría no encontrarlo aún.
  onAdFallbackCandidate: async (job: FallbackJob) => {
    await enqueueAdsJob({ kind: "fallback", job }, 30_000);
  },
};

export function startAdsWorker({ provider, storage }: { provider: MessagingProvider; storage: ObjectStorage | null }) {
  const worker = new Worker<AdsJob>(
    ADS_QUEUE,
    async (job) => {
      const data = job.data;
      switch (data.kind) {
        case "thumb": {
          if (!storage) return "sin bucket: miniatura pendiente";
          try {
            const r = await storeAdThumbnail(storage, data.organizationId, data.adId, data.url);
            return `miniatura de ${data.adId}: ${r}`;
          } catch (error) {
            // El link de la ficha caducado (4xx) no se reintenta: la miniatura
            // saldrá del creativo cuando llegue de Meta.
            if (data.url && error instanceof ThumbnailError && error.httpStatus >= 400 && error.httpStatus < 500) {
              return `miniatura de ${data.adId}: link de la ficha no sirve (${error.message}); se usará el del creativo`;
            }
            throw error;
          }
        }
        case "meta": {
          const r = await refreshMetaAd(data.organizationId, data.adId);
          if (r.status === "actualizado" && r.needsThumbnail && storage) {
            await enqueueAdsJob({ kind: "thumb", organizationId: data.organizationId, adId: data.adId });
          }
          // Un error de Meta NO lanza: ya quedó anotado con su espera y el
          // barrido lo retoma (reintentar aquí martillaría la API).
          return r.status === "error"
            ? `anuncio ${data.adId}: error (${r.error}); reintento en ${Math.round(r.retryInMs / 60_000)} min`
            : `anuncio ${data.adId}: ${r.status}`;
        }
        case "status": {
          const r = await refreshAdStatuses();
          return r.status === "actualizado"
            ? `estado de ${r.checked} anuncio(s) en Meta: ${r.updated} leído(s)`
            : r.status === "error"
              ? `estado de los anuncios: error (${r.error}); se reintenta en 1 h`
              : "estado de los anuncios: ninguno identificado aún";
        }
        case "fallback": {
          const { result, click } = await attributeFromProviderConversation(provider, data.job);
          if (click) await enqueueAfterClick(click);
          return `respaldo ${data.job.messageId}: ${result}`;
        }
        case "record": {
          const click = await recordClickFromMessage(data.organizationId, data.messageId);
          if (click) await enqueueAfterClick(click);
          return click ? `clic registrado (red de seguridad) para ${data.messageId}` : `sin clic nuevo para ${data.messageId}`;
        }
      }
    },
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 2, autorun: false },
  );
  worker.on("completed", (job, result) => console.info(`[anuncios] ${String(result)}`));
  worker.on("failed", (job, error) => {
    console.error(`[anuncios] falló ${job?.data.kind} (intento ${job?.attemptsMade}): ${error.message}`);
  });

  // El programador de cada hora vive en Redis; se registra en el primer barrido que lo logre.
  let statusScheduled = false;

  async function sweep(): Promise<void> {
    if (!statusScheduled) statusScheduled = await scheduleAdStatusRefresh(STATUS_REFRESH_MS);
    // 1) Red de seguridad: fichas guardadas en el mensaje sin clic registrado.
    for (const m of await messagesWithUnrecordedReferral()) {
      await enqueueAdsJob({ kind: "record", organizationId: m.organizationId, messageId: m.id });
    }
    // 1b) Respaldos pendientes o por reintentar (registro durable en el mensaje).
    for (const job of await messagesPendingFallback()) await enqueueAdsJob({ kind: "fallback", job });
    if (storage) {
      // 2) Miniaturas pendientes con el link del creativo (hasta el tope de intentos).
      const pendingThumbs = await db
        .select({ organizationId: metaAds.organizationId, adId: metaAds.adId })
        .from(metaAds)
        .where(
          and(
            isNull(metaAds.thumbnailKey),
            isNotNull(metaAds.thumbnailUrl),
            lt(metaAds.thumbnailAttempts, THUMB_MAX_ATTEMPTS),
          ),
        )
        .limit(20);
      for (const a of pendingThumbs) await enqueueAdsJob({ kind: "thumb", ...a });
    }
    // 4) Nombres de Meta: nunca consultados, o fallidos cuya espera ya pasó.
    const due = await db
      .select({ organizationId: metaAds.organizationId, adId: metaAds.adId })
      .from(metaAds)
      .where(
        and(
          or(isNull(metaAds.fetchedAt), isNotNull(metaAds.fetchError)),
          // next_fetch_at lo escribe el worker desde JS (UTC): se compara con una fecha de JS.
          or(isNull(metaAds.nextFetchAt), lte(metaAds.nextFetchAt, new Date())),
        ),
      )
      .limit(20);
    for (const a of due) await enqueueAdsJob({ kind: "meta", ...a });
  }

  return {
    run: () => void worker.run(),
    sweep,
    close: () => worker.close(),
  };
}
