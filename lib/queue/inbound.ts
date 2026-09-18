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
