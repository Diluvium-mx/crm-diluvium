// Cola de corridas de workflows (Fase D): un job por `workflow_runs.id`. La
// base es la fuente de verdad: si Redis no responde al encolar, la fila queda
// "queued" y el barrido del worker la recoge (mismo patrón que scheduled).
import { Queue } from "bullmq";
import { redisConnection } from "./inbound";

export const WORKFLOW_QUEUE = "workflow-runs";

export type WorkflowJob = { runId: string };

const globalForQueue = globalThis as unknown as { workflowQueue?: Queue<WorkflowJob> };

function workflowQueue(): Queue<WorkflowJob> {
  globalForQueue.workflowQueue ??= new Queue<WorkflowJob>(WORKFLOW_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      // El ejecutor NO lanza por fallos de negocio (los deja en la fila con su
      // código): un reintento de BullMQ solo cubre caídas de infraestructura
      // antes de reclamar la corrida. Reintentar una corrida a medias podría
      // repetir un envío: por eso el ejecutor retoma por cursor, nunca desde 0.
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
      removeOnFail: { age: 14 * 24 * 3600 },
    },
  });
  return globalForQueue.workflowQueue;
}

export function workflowJobId(runId: string): string {
  return `wfrun_${runId}`;
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

/** Encola la corrida. Nunca lanza: false = el barrido la recogerá. */
export async function enqueueWorkflowRun(runId: string): Promise<boolean> {
  try {
    await withTimeout(workflowQueue().add("run", { runId }, { jobId: workflowJobId(runId) }));
    return true;
  } catch (error) {
    console.error("[workflows] no se pudo encolar; lo recogerá el barrido", runId, error);
    return false;
  }
}

/** Barrido: una corrida "queued" vieja perdió su job (o falló): se revisa y reintenta. */
export async function reviveWorkflowRun(runId: string): Promise<"added" | "retried" | "in_flight" | "error"> {
  try {
    const job = await workflowQueue().getJob(workflowJobId(runId));
    if (!job) return (await enqueueWorkflowRun(runId)) ? "added" : "error";
    const state = await job.getState();
    if (state === "failed") {
      await job.retry("failed");
      return "retried";
    }
    if (state === "completed" || state === "unknown") {
      await job.remove();
      return (await enqueueWorkflowRun(runId)) ? "added" : "error";
    }
    return "in_flight";
  } catch (error) {
    console.error("[workflows] barrido no pudo revisar el job", runId, error);
    return "error";
  }
}
