// Corridas de workflows en el worker (Fase D): consume la cola y, en el barrido
// de cada minuto, re-encola las corridas "queued" que perdieron su job y da por
// fallidas las "running" atoradas. La base es la fuente de verdad.
// Barrido RÁPIDO (28-sep-2026): cada 5 s revisa las "queued" de más de 5 s; una
// corrida que no se pudo encolar (o agotó sus reintentos por "busy") sale en
// segundos, no en el barrido de cada minuto.
import { Worker } from "bullmq";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { redisConnection } from "@/lib/queue/inbound";
import { reviveWorkflowRun, WORKFLOW_QUEUE, type WorkflowJob } from "@/lib/queue/workflows";
import type { ObjectStorage } from "@/lib/storage/s3";
import { executeWorkflowRun, failStuckRuns, staleQueuedRuns, staleRunningRuns } from "@/lib/workflows/executor";

export const QUICK_SWEEP_EVERY_MS = 5_000;
// Una "queued" más joven que esto está recién encolada: su job la toma solo.
export const QUICK_SWEEP_GRACE_MS = 5_000;

export function startWorkflowWorker(provider: MessagingProvider, storage: ObjectStorage | null) {
  const worker = new Worker<WorkflowJob>(
    WORKFLOW_QUEUE,
    async (job) => {
      const outcome = await executeWorkflowRun(job.data.runId, { provider, storage });
      console.info(`[workflows] ${job.data.runId}: ${outcome}`);
      // Otra corrida de la misma conversación en curso: BullMQ reintenta con
      // backoff; si agota intentos, el barrido la vuelve a encolar.
      if (outcome === "busy") throw new Error("conversación ocupada por otra corrida; reintentar");
      return outcome;
    },
    // Concurrencia 3: una corrida con pasos "esperar" no debe retrasar a los
    // demás clientes (tope de espera 60 s por paso; GHL espera 30 s antes de la tabla). Dos corridas de la MISMA
    // conversación no se intercalan: el reclamo toma un candado por conversación
    // y la segunda espera ("busy" → reintento).
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 3, autorun: false },
  );
  worker.on("failed", (job, error) => {
    console.error(`[workflows] falló ${job?.data.runId} (intento ${job?.attemptsMade}): ${error.message}`);
  });

  async function sweep() {
    const stale = [...(await staleQueuedRuns()), ...(await staleRunningRuns())];
    let revived = 0;
    for (const id of stale) {
      const r = await reviveWorkflowRun(id);
      if (r === "added" || r === "retried") revived++;
    }
    if (revived) console.info(`[workflows] barrido: ${revived} corrida(s) re-encoladas`);
    const stuck = await failStuckRuns();
    if (stuck) console.warn(`[workflows] barrido: ${stuck} corrida(s) atoradas marcadas como fallidas`);
  }

  // Solo re-encola corridas "queued" SIN job vivo (reviveWorkflowRun deja en paz
  // las que esperan en la cola o su reintento): nunca ejecuta dos veces.
  async function quickSweep() {
    let revived = 0;
    for (const id of await staleQueuedRuns(new Date(), QUICK_SWEEP_GRACE_MS)) {
      const r = await reviveWorkflowRun(id);
      if (r === "added" || r === "retried") revived++;
    }
    if (revived) console.info(`[workflows] barrido rápido: ${revived} corrida(s) re-encoladas`);
  }
  let quickTimer: ReturnType<typeof setInterval> | undefined;
  let quickRunning = false;

  return {
    worker,
    sweep,
    run: () => {
      void worker.run();
      quickTimer ??= setInterval(() => {
        if (quickRunning) return;
        quickRunning = true;
        quickSweep()
          .catch((error) => console.error("[workflows] barrido rápido falló", error))
          .finally(() => {
            quickRunning = false;
          });
      }, QUICK_SWEEP_EVERY_MS);
    },
    close: () => {
      clearInterval(quickTimer);
      return worker.close();
    },
  };
}
