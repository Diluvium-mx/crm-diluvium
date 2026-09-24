// Worker de anuncios (corre dentro del servicio `worker`). Nada de esto frena
// un mensaje: el mensaje ya está guardado cuando llega aquí.
// - media: copia la imagen/video/miniatura de la ficha al bucket (los links de
//   Meta caducan en horas);
// - meta: nombres de campaña/conjunto/anuncio y creativo (caché por anuncio);
// - creative_media: copia la media del creativo (respaldo visual);
// - fallback: mensaje que parecía de anuncio sin ficha → primer clic guardado
//   por Zernio en la conversación;
// - record: red de seguridad si el clic no se registró en la ingesta.
// El barrido (cada minuto) re-encola lo pendiente desde la base.
import { Worker } from "bullmq";
import { and, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adClicks, metaAds } from "@/lib/db/schema";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { redisConnection } from "@/lib/queue/inbound";
import { ADS_QUEUE, enqueueAdsJob, type AdsJob } from "@/lib/queue/ads";
import type { ObjectStorage } from "@/lib/storage/s3";
import {
  attributeFromProviderConversation,
  messagesWithUnrecordedReferral,
  recordClickFromMessage,
  type FallbackJob,
  type RecordedClick,
} from "./attribution";
import { AD_MEDIA_GIVE_UP_HOURS, downloadClickMedia, downloadCreativeMedia } from "./media";
import { refreshMetaAd } from "./meta-cache";

/** Encola lo que sigue a un clic nuevo: su media y los nombres de Meta. */
export async function enqueueAfterClick(click: RecordedClick): Promise<void> {
  if (click.hasMedia) await enqueueAdsJob({ kind: "media", clickId: click.clickId });
  if (click.adId) await enqueueAdsJob({ kind: "meta", organizationId: click.organizationId, adId: click.adId });
}

/** Ganchos de la ingesta (lib/messaging/ingest.ts → IngestHooks). */
export const adsIngestHooks = {
  onAdClick: enqueueAfterClick,
  onAdFallbackCandidate: async (job: FallbackJob) => {
    await enqueueAdsJob({ kind: "fallback", job });
  },
};

export function startAdsWorker({ provider, storage }: { provider: MessagingProvider; storage: ObjectStorage | null }) {
  const worker = new Worker<AdsJob>(
    ADS_QUEUE,
    async (job) => {
      const data = job.data;
      switch (data.kind) {
        case "media": {
          if (!storage) return "sin bucket: media pendiente";
          const r = await downloadClickMedia(storage, data.clickId);
          return `media del clic ${data.clickId}: ${r.stored} guardado(s), ${r.pending} pendiente(s)`;
        }
        case "meta": {
          const r = await refreshMetaAd(data.organizationId, data.adId);
          if (r === "actualizado" && storage) await enqueueAdsJob({ kind: "creative_media", organizationId: data.organizationId, adId: data.adId });
          // Un error de Meta NO lanza: ya quedó anotado con su espera y el
          // barrido lo retoma (reintentar aquí martillaría la API).
          return typeof r === "string" ? `anuncio ${data.adId}: ${r}` : `anuncio ${data.adId}: error (${r.error}); reintento en ${Math.round(r.retryInMs / 60_000)} min`;
        }
        case "creative_media": {
          if (!storage) return "sin bucket";
          const r = await downloadCreativeMedia(storage, data.organizationId, data.adId);
          return `creativo ${data.adId}: ${r.stored} guardado(s), ${r.pending} pendiente(s)`;
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

  async function sweep(): Promise<void> {
    // 1) Red de seguridad: fichas guardadas en el mensaje sin clic registrado.
    for (const m of await messagesWithUnrecordedReferral()) {
      await enqueueAdsJob({ kind: "record", organizationId: m.organizationId, messageId: m.id });
    }
    if (storage) {
      // 2) Media de clics pendiente (los links caducan: solo las últimas 48 h).
      const pendingMedia = await db
        .select({ id: adClicks.id })
        .from(adClicks)
        .where(
          and(
            gte(adClicks.createdAt, sql`now() - make_interval(hours => ${AD_MEDIA_GIVE_UP_HOURS})`),
            lte(adClicks.createdAt, sql`now() - interval '1 minute'`),
            sql`exists (select 1 from jsonb_array_elements(${adClicks.media}) m
                        where m->>'storageKey' is null and m->>'givenUpAt' is null)`,
          ),
        )
        .limit(50);
      for (const { id } of pendingMedia) await enqueueAdsJob({ kind: "media", clickId: id });
      // 3) Media del creativo pendiente.
      const pendingCreative = await db
        .select({ organizationId: metaAds.organizationId, adId: metaAds.adId })
        .from(metaAds)
        .where(
          and(
            isNotNull(metaAds.fetchedAt),
            sql`exists (select 1 from jsonb_array_elements(${metaAds.creativeMedia}) m
                        where m->>'storageKey' is null and m->>'givenUpAt' is null)`,
          ),
        )
        .limit(20);
      for (const a of pendingCreative) await enqueueAdsJob({ kind: "creative_media", ...a });
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
