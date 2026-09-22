// Cola de mensajes programados (A6): un job DIFERIDO por programación. El
// jobId incluye la hora de envío, así una edición crea un job nuevo y el viejo,
// si llega a disparar, encuentra otra hora en la base y no hace nada.
//
// Encolar nunca rompe la acción del vendedor: si Redis no responde, la fila ya
// está en la base y el barrido del worker la recoge cuando se vence.
import { Queue } from "bullmq";
import { redisConnection } from "./inbound";

export const SCHEDULED_QUEUE = "scheduled-messages";

export type ScheduledJob = { scheduledId: string; sendAtMs: number };

const globalForQueue = globalThis as unknown as { scheduledQueue?: Queue<ScheduledJob> };

function scheduledQueue(): Queue<ScheduledJob> {
  globalForQueue.scheduledQueue ??= new Queue<ScheduledJob>(SCHEDULED_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      // El procesador no lanza en fallos de negocio (los marca en la fila);
      // solo reintenta errores de infraestructura antes de tomar la fila.
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
      removeOnFail: { age: 14 * 24 * 3600 },
    },
  });
  return globalForQueue.scheduledQueue;
}

export function scheduledJobId(scheduledId: string, sendAtMs: number): string {
  return `sched_${scheduledId}_${sendAtMs}`;
}

const ENQUEUE_TIMEOUT_MS = 1_500;

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout de Redis")), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Encola el envío para `sendAt` (o ya, si está vencido). Nunca lanza. */
export async function enqueueScheduled(scheduledId: string, sendAt: Date): Promise<boolean> {
  const sendAtMs = sendAt.getTime();
  try {
    await withTimeout(
      scheduledQueue().add(
        "send",
        { scheduledId, sendAtMs },
        { jobId: scheduledJobId(scheduledId, sendAtMs), delay: Math.max(0, sendAtMs - Date.now()) },
      ),
    );
    return true;
  } catch (error) {
    console.error("[scheduled] no se pudo encolar; lo recogerá el barrido", scheduledId, error);
    return false;
  }
}

/** Quita el job de una hora vieja (al editar o cancelar). Si no se puede, no pasa nada: el job es inofensivo. */
export async function removeScheduledJob(scheduledId: string, sendAt: Date): Promise<void> {
  try {
    const job = await withTimeout(scheduledQueue().getJob(scheduledJobId(scheduledId, sendAt.getTime())));
    if (job && (await job.getState()) === "delayed") await job.remove();
  } catch (error) {
    console.warn("[scheduled] no se pudo quitar el job viejo (se ignorará al disparar)", scheduledId, error);
  }
}

/**
 * Barrido del worker: una fila vencida que sigue "scheduled" perdió su job
 * (o este falló). Un `add` con un jobId existente no re-encola, así que se
 * revisa su estado y se reintenta explícitamente (mismo patrón que reviveInbound).
 */
export async function reviveScheduled(scheduledId: string, sendAt: Date): Promise<"added" | "retried" | "in_flight" | "error"> {
  try {
    const job = await scheduledQueue().getJob(scheduledJobId(scheduledId, sendAt.getTime()));
    if (!job) return (await enqueueScheduled(scheduledId, sendAt)) ? "added" : "error";
    const state = await job.getState();
    if (state === "failed") {
      await job.retry("failed");
      return "retried";
    }
    if (state === "completed" || state === "unknown") {
      await job.remove();
      return (await enqueueScheduled(scheduledId, sendAt)) ? "added" : "error";
    }
    return "in_flight";
  } catch (error) {
    console.error("[scheduled] barrido no pudo revisar el job", scheduledId, error);
    return "error";
  }
}
