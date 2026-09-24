// Corridas de workflows en el worker (Fase D): consume la cola y, en el barrido
// de cada minuto, re-encola las corridas "queued" que perdieron su job y da por
// fallidas las "running" atoradas. La base es la fuente de verdad.
import { Worker } from "bullmq";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { redisConnection } from "@/lib/queue/inbound";
import { reviveWorkflowRun, WORKFLOW_QUEUE, type WorkflowJob } from "@/lib/queue/workflows";
import type { ObjectStorage } from "@/lib/storage/s3";
import { executeWorkflowRun, failStuckRuns, staleQueuedRuns, staleRunningRuns } from "@/lib/workflows/executor";

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

  return { worker, sweep, run: () => void worker.run(), close: () => worker.close() };
}
