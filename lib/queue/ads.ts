// Cola de anuncios (BullMQ): miniatura del anuncio al bucket, nombres de Meta,
// respaldo con la conversación de Zernio y red de seguridad del registro del
// clic. La base es la fuente de verdad: si encolar falla, el barrido del worker
// lo recoge (lib/ads/worker.ts).
import { Queue } from "bullmq";
import type { FallbackJob } from "@/lib/ads/attribution";
import { redisConnection } from "./inbound";

export const ADS_QUEUE = "ads";

export type AdsJob =
  /** Miniatura del anuncio; `url` = link de la ficha (sin él, el del creativo). */
  | { kind: "thumb"; organizationId: string; adId: string; url?: string }
  | { kind: "meta"; organizationId: string; adId: string }
  | { kind: "fallback"; job: FallbackJob }
  | { kind: "record"; organizationId: string; messageId: string };

const globalForQueue = globalThis as unknown as { adsQueue?: Queue<AdsJob> };

function adsQueue(): Queue<AdsJob> {
  globalForQueue.adsQueue ??= new Queue<AdsJob>(ADS_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      attempts: 6,
      backoff: { type: "exponential", delay: 20_000 },
      // Se borran al terminar (bien o mal): el mismo jobId puede volver a
      // encolarse (el barrido lo retoma; los topes de intentos viven en la
      // base). Un job fallido que se quedara guardado haría que BullMQ ignore
      // el reencolado con su mismo jobId. Mientras un job existe, un duplicado
      // se ignora (deduplicación).
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return globalForQueue.adsQueue;
}

// BullMQ no acepta ":" en jobId.
function jobId(job: AdsJob): string {
  const id = (() => {
    switch (job.kind) {
      case "thumb":
      case "meta":
        return `${job.kind}_${job.organizationId}_${job.adId}`;
      case "fallback":
        return `fallback_${job.job.messageId}`;
      case "record":
        return `record_${job.messageId}`;
    }
  })();
  return id.replace(/:/g, "_");
}

const ENQUEUE_TIMEOUT_MS = 1_500;

/** Encola sin bloquear más de ENQUEUE_TIMEOUT_MS; nunca lanza. */
export async function enqueueAdsJob(job: AdsJob, delayMs = 0): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      adsQueue().add(job.kind, job, { jobId: jobId(job), ...(delayMs > 0 ? { delay: delayMs } : {}) }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout al encolar")), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (error) {
    console.error(`[anuncios] no se pudo encolar ${job.kind}; lo recogerá el barrido`, error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
