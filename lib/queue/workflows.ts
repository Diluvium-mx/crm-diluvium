// Cola de corridas de workflows (Fase D): un job por `workflow_runs.id`. La
// base es la fuente de verdad: si Redis no responde al encolar, la fila queda
// "queued" y el barrido rápido del worker (cada 5 s) la recoge.
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

// Un fallo al encolar suele ser un parpadeo de la conexión: se reintenta de
// inmediato una vez (28-sep-2026: un "/" del vendedor no debe esperar al barrido).
const ENQUEUE_ATTEMPTS = 2;
const ENQUEUE_RETRY_MS = 200;

/** Encola la corrida. Nunca lanza: false = la toma el barrido rápido del worker (segundos). */
export async function enqueueWorkflowRun(runId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= ENQUEUE_ATTEMPTS; attempt++) {
    try {
      // Mismo jobId: si el 1.er intento sí llegó a Redis, el 2.º no duplica el job.
      await withTimeout(workflowQueue().add("run", { runId }, { jobId: workflowJobId(runId) }));
      return true;
    } catch (error) {
      if (attempt < ENQUEUE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, ENQUEUE_RETRY_MS));
        continue;
      }
      console.error("[workflows] no se pudo encolar; lo toma el barrido rápido del worker", runId, error);
    }
  }
  return false;
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
