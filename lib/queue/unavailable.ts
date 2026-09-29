// Doble verificación del aviso "no disponible" (caso SDA, 29-sep-2026): la ingesta
// encola aquí un job DIFERIDO por cada aviso 131060 del primer entrante; el worker
// lo decide a los VERIFY_AFTER_MS (lib/messaging/unavailable-check.ts). La base es
// la fuente de verdad: si Redis no responde, el barrido del worker lo recoge.
import { Queue } from "bullmq";
import { VERIFY_AFTER_MS } from "@/lib/messaging/unavailable";
import { redisConnection } from "./inbound";

export const UNAVAILABLE_QUEUE = "no-disponible";

export type UnavailableJob = { organizationId: string; messageId: string };

const globalForQueue = globalThis as unknown as { unavailableQueue?: Queue<UnavailableJob> };

function unavailableQueue(): Queue<UnavailableJob> {
  globalForQueue.unavailableQueue ??= new Queue<UnavailableJob>(UNAVAILABLE_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      // La verificación es idempotente (solo decide un aviso "verificando").
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return globalForQueue.unavailableQueue;
}

export function unavailableJobId(messageId: string): string {
  return `nodisp_${messageId}`.replace(/:/g, "_");
}

const ENQUEUE_TIMEOUT_MS = 1_500;

/** Encola la verificación a los VERIFY_AFTER_MS. Lanza si Redis no responde (quien llama lo registra; el barrido lo recoge). */
export async function enqueueUnavailableCheck(job: UnavailableJob, delayMs = VERIFY_AFTER_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      unavailableQueue().add("verificar", job, { jobId: unavailableJobId(job.messageId), delay: Math.max(0, delayMs) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout de Redis")), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
