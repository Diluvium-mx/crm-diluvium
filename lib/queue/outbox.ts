// Fila de espera de envíos del web (Bloque B, 28-sep-2026): cuando Zernio pide
// esperar (429) o la conversación tiene un envío más viejo en fila, la Server
// Action del vendedor no espera en la petición: deja la fila "queued" con su
// marca de turno (messages.metadata.envio.diferido) y encola aquí un job
// DIFERIDO. El worker lo manda en su turno con la misma clave de idempotencia
// (resumeDeferredSend). La base es la fuente de verdad: si Redis no responde,
// el barrido del worker recoge los diferidos sin job.
import { Queue } from "bullmq";
import { redisConnection } from "./inbound";

export const OUTBOX_QUEUE = "outbox-sends";

export type OutboxJob = { messageId: string; organizationId: string; readCutoffMessageId: string | null };

const globalForQueue = globalThis as unknown as { outboxQueue?: Queue<OutboxJob> };

function outboxQueue(): Queue<OutboxJob> {
  globalForQueue.outboxQueue ??= new Queue<OutboxJob>(OUTBOX_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      // resumeDeferredSend no repite nada ya resuelto: un reintento de BullMQ
      // (caída de infraestructura) es seguro.
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return globalForQueue.outboxQueue;
}

export function outboxJobId(messageId: string): string {
  return `envio_${messageId}`;
}

const ENQUEUE_TIMEOUT_MS = 1_500;

/** Encola el envío en espera. Lanza si Redis no responde (quien llama lo registra; el barrido lo recoge). */
export async function enqueueOutboxSend(job: OutboxJob & { delayMs: number }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      outboxQueue().add(
        "send",
        { messageId: job.messageId, organizationId: job.organizationId, readCutoffMessageId: job.readCutoffMessageId },
        { jobId: outboxJobId(job.messageId), delay: Math.max(0, job.delayMs) },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout de Redis")), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
