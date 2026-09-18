// Cola de webhooks entrantes (BullMQ sobre el Redis del proyecto).
//
// El webhook solo guarda el evento crudo en webhook_events y encola su id; el
// worker lo procesa (CLAUDE.md §4: responder 200 en < 5 s, nada pesado en el
// web). Si encolar falla, el evento YA está en la base: el barrido periódico
// del worker (pendingWebhookEvents) lo recoge. Encolar es optimización de
// latencia, no la fuente de verdad.
import { Queue, type ConnectionOptions } from "bullmq";

export const INBOUND_QUEUE = "inbound-webhooks";

export type InboundJob = { webhookEventId: string };

export function redisConnection(): ConnectionOptions {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set");
  return { url: process.env.REDIS_URL };
}

const globalForQueue = globalThis as unknown as { inboundQueue?: Queue<InboundJob> };

function inboundQueue(): Queue<InboundJob> {
  globalForQueue.inboundQueue ??= new Queue<InboundJob>(INBOUND_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 10_000 },
      removeOnFail: { age: 14 * 24 * 3600 },
    },
  });
  return globalForQueue.inboundQueue;
}

const ENQUEUE_TIMEOUT_MS = 1_500;

/** Encola sin bloquear el webhook más de ENQUEUE_TIMEOUT_MS. Devuelve si lo logró. */
export async function enqueueInbound(webhookEventId: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      // jobId = id del evento: BullMQ ignora un add con un jobId que ya existe.
      inboundQueue().add("process", { webhookEventId }, { jobId: webhookEventId }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout al encolar")), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (error) {
    console.error("[inbound] no se pudo encolar; lo recogerá el barrido del worker", webhookEventId, error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Usado por el barrido del worker. Un `add` con un jobId que ya existe NO
 * re-encola (BullMQ lo trata como duplicado), así que un job agotado en
 * "failed" quedaría varado aunque su evento siga pendiente en la base. Aquí
 * se revisa su estado y se reintenta explícitamente.
 */
export async function reviveInbound(webhookEventId: string): Promise<"added" | "retried" | "in_flight" | "error"> {
  try {
    const job = await inboundQueue().getJob(webhookEventId);
    if (!job) return (await enqueueInbound(webhookEventId)) ? "added" : "error";
    const state = await job.getState();
    if (state === "failed") {
      await job.retry("failed");
      return "retried";
    }
    if (state === "completed" || state === "unknown") {
      // Completado pero la base sigue pendiente (no debería pasar): se recrea.
      await job.remove();
      return (await enqueueInbound(webhookEventId)) ? "added" : "error";
    }
    return "in_flight"; // waiting / delayed / active: ya va en camino
  } catch (error) {
    console.error("[inbound] barrido no pudo revisar el job", webhookEventId, error);
    return "error";
  }
}

// ─── Descarga de media ──────────────────────────────────────────────────────

export const MEDIA_QUEUE = "media-download";
export type MediaJob = { messageId: string };

const globalForMediaQueue = globalThis as unknown as { mediaQueue?: Queue<MediaJob> };

function mediaQueue(): Queue<MediaJob> {
  globalForMediaQueue.mediaQueue ??= new Queue<MediaJob>(MEDIA_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      // ~1 h de reintentos con backoff; después sigue el barrido del worker.
      attempts: 10,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 24 * 3600, count: 10_000 },
      removeOnFail: { age: 14 * 24 * 3600 },
    },
  });
  return globalForMediaQueue.mediaQueue;
}

/** Encola la descarga de los adjuntos de un mensaje. Nunca lanza: el barrido cubre fallos. */
export async function enqueueMediaDownload(messageId: string): Promise<void> {
  const jobId = `media_${messageId}`;
  try {
    const existing = await mediaQueue().getJob(jobId);
    if (existing && (await existing.getState()) === "failed") {
      await existing.retry("failed");
      return;
    }
    if (existing && (await existing.getState()) === "completed") await existing.remove();
    await mediaQueue().add("download", { messageId }, { jobId });
  } catch (error) {
    console.error("[media] no se pudo encolar; lo recogerá el barrido", messageId, error);
  }
}
