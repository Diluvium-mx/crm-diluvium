// Mensajes programados en el worker (A6): consume la cola diferida y, en el
// barrido de cada minuto, recupera los vencidos que perdieron su job y marca
// como fallidos los envíos atorados. La base es la fuente de verdad.
import { Worker } from "bullmq";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { redisConnection } from "@/lib/queue/inbound";
import { reviveScheduled, SCHEDULED_QUEUE, type ScheduledJob } from "@/lib/queue/scheduled";
import { dispatchScheduled, failStuckSending } from "@/lib/scheduled/dispatch";
import { dueScheduled } from "@/lib/scheduled/store";

// Un programado vencido por más de esto sin enviarse perdió su job.
const DUE_GRACE_MS = 30_000;

export function startScheduledWorker(provider: MessagingProvider) {
  const worker = new Worker<ScheduledJob>(
    SCHEDULED_QUEUE,
    async (job) => {
      const outcome = await dispatchScheduled(provider, job.data.scheduledId, job.data.sendAtMs);
      console.info(`[scheduled] ${job.data.scheduledId}: ${outcome}`);
      return outcome;
    },
    // autorun: false → worker/index.ts lo arranca cuando la base ya tiene las
    // migraciones (mismo patrón que las otras colas).
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 2, autorun: false },
  );
  worker.on("failed", (job, error) => {
    console.error(`[scheduled] falló ${job?.data.scheduledId} (intento ${job?.attemptsMade}): ${error.message}`);
  });

  async function sweep() {
    const due = await dueScheduled(new Date(), DUE_GRACE_MS);
    let revived = 0;
    for (const row of due) {
      const result = await reviveScheduled(row.id, row.sendAt);
      if (result === "added" || result === "retried") revived++;
    }
    if (revived) console.info(`[scheduled] barrido: ${revived} programado(s) vencidos re-encolados`);
    const stuck = await failStuckSending();
    if (stuck) console.warn(`[scheduled] barrido: ${stuck} envío(s) programados atorados conciliados (sent si ya salió; si no, failed sin reintento)`);
  }

  return { worker, sweep, run: () => void worker.run(), close: () => worker.close() };
}
