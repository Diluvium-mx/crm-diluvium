// «Despertar» desde la píldora dormida (10-oct-2026, docs/seguimientos.md §22): el web encola la lectura y el worker
// corre el lector AL MOMENTO en modo despertar (worker/despertar.ts), sin esperar el barrido de cada minuto.
import { Queue } from "bullmq";
import { redisConnection } from "./inbound";

export const DESPERTAR_QUEUE = "despertar-seguimiento";

export type DespertarJob = { organizationId: string; conversationId: string };

const globalForQueue = globalThis as unknown as { despertarQueue?: Queue<DespertarJob> };

function despertarQueue(): Queue<DespertarJob> {
  globalForQueue.despertarQueue ??= new Queue<DespertarJob>(DESPERTAR_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      // Si el lector ya está leyendo ese chat (candado), se reintenta a los pocos segundos.
      attempts: 6,
      backoff: { type: "fixed", delay: 4_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return globalForQueue.despertarQueue;
}

const ENQUEUE_TIMEOUT_MS = 1_500;

/** Un solo «Despertar» en curso por chat (jobId). Lanza si Redis no responde: quien llama avisa que no se pudo. */
export async function enqueueDespertar(job: DespertarJob): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      despertarQueue().add("despertar", job, { jobId: `despertar_${job.conversationId}`.replace(/:/g, "_") }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout de Redis")), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
