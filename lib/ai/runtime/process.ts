// Una corrida del job del agente, con candado y re-programación. Sin DB ni
// BullMQ directos (todo inyectado) para poder probarla con dobles; el cableado
// real está en worker.ts.
import { acquireLock, dirtyKey, releaseLock, type AgentJob, type KvPort } from "./queue";
import type { RunResult } from "./run";

// El candado dura más que la peor corrida (filtro + cerebro × 3 rondas).
export const LOCK_TTL_MS = 5 * 60_000;
export const LOCKED_RETRY_MS = 5_000;

export type ProcessDeps = {
  kv: KvPort;
  now: () => Date;
  run: (job: AgentJob) => Promise<RunResult>;
  delayFor: (organizationId: string, conversationId: string, now: Date) => Promise<number | null>;
};

// Devuelve cuándo re-programar el MISMO job (ms) o null.
export async function processAgentJob(
  data: AgentJob,
  deps: ProcessDeps,
): Promise<{ result: RunResult | null; rescheduleMs: number | null }> {
  const id = data.conversationId;
  // Esta corrida lee la BD fresca: los avisos anteriores ya quedan cubiertos.
  await deps.kv.getDel(dirtyKey(id));
  const token = await acquireLock(deps.kv, id, LOCK_TTL_MS);
  if (!token) return { result: null, rescheduleMs: LOCKED_RETRY_MS };
  let result: RunResult;
  try {
    result = await deps.run(data);
  } finally {
    await releaseLock(deps.kv, id, token);
  }
  if (result.kind === "reschedule") return { result, rescheduleMs: result.delayMs };
  // Entró algo mientras corría: otra vuelta con su debounce.
  if (await deps.kv.getDel(dirtyKey(id))) {
    const delay = await deps.delayFor(data.organizationId, id, deps.now());
    if (delay !== null) return { result, rescheduleMs: delay };
  }
  return { result, rescheduleMs: null };
}
