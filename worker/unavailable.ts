// Doble verificación del aviso "no disponible" (caso SDA, 29-sep-2026): consume la
// cola diferida y, en el barrido de cada minuto, decide los avisos que perdieron su
// job. Lógica en lib/messaging/unavailable-check.ts.
import { Worker } from "bullmq";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { noticesToVerify, verifyUnavailableNotice, type VerifyHooks } from "@/lib/messaging/unavailable-check";
import { redisConnection } from "@/lib/queue/inbound";
import { UNAVAILABLE_QUEUE, type UnavailableJob } from "@/lib/queue/unavailable";

export function startUnavailableWorker(provider: MessagingProvider, hooks: VerifyHooks) {
  const worker = new Worker<UnavailableJob>(
    UNAVAILABLE_QUEUE,
    async (job) => {
      const outcome = await verifyUnavailableNotice(provider, job.data, hooks);
      console.info(`[no-disponible] ${job.data.messageId}: ${outcome}`);
      return outcome;
    },
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 5, autorun: false },
  );
  worker.on("failed", (job, error) => {
    console.error(`[no-disponible] falló ${job?.data.messageId} (intento ${job?.attemptsMade}): ${error.message}`);
  });

  async function sweep() {
    const pending = await noticesToVerify();
    let decided = 0;
    for (const notice of pending) {
      try {
        const outcome = await verifyUnavailableNotice(provider, notice, hooks);
        if (outcome !== "reintentar" && outcome !== "esperando") decided++;
        console.info(`[no-disponible] barrido ${notice.messageId}: ${outcome}`);
      } catch (error) {
        console.error(`[no-disponible] barrido no pudo verificar ${notice.messageId}`, error);
      }
    }
    if (decided) console.info(`[no-disponible] barrido: ${decided} aviso(s) decididos`);
  }

  return { worker, sweep, run: () => void worker.run(), close: () => worker.close() };
}
