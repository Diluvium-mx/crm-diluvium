// Consumer del Agente IA (Fase B). Lo arranca el servicio `worker` con UNA línea
// (startAgentRuntime) — el registro en worker/index.ts se hace al final, en un
// cambio mínimo. Todo lo demás vive aquí.
import { DelayedError, Worker } from "bullmq";
import { callModel } from "@/lib/ai";
import { redisConnection } from "@/lib/queue/inbound";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { sendTextMessage } from "@/lib/messaging/send";
import type { ObjectStorage } from "@/lib/storage/s3";
import { processAgentJob } from "./process";
import {
  AGENT_QUEUE,
  bullAgentQueuePort,
  closeAgentConnections,
  redisKvPort,
  scheduleAgentRun,
  type AgentJob,
  type AgentQueuePort,
  type KvPort,
} from "./queue";
import { runAgent, type RunDeps, type RunResult } from "./run";
import { debounceDelayFor } from "./schedule";
import { findOrphanConversations, reactivateExpiredHandovers } from "./sweep";

const SWEEP_EVERY_MS = 60_000;

function describe(result: RunResult | null): string {
  if (!result) return "candado ocupado, reintento";
  switch (result.kind) {
    case "sent":
      return `enviado (${result.bubbles} burbuja/s)`;
    case "draft":
      return `borrador ${result.draftId}`;
    case "reschedule":
      return `re-programado en ${result.delayMs} ms (${result.reason})`;
    default:
      return `${result.kind}: ${result.reason}`;
  }
}

export function makeRunDeps(provider: MessagingProvider, storage: ObjectStorage | null): RunDeps {
  return {
    now: () => new Date(),
    callModel,
    sendBubble: async ({ organizationId, conversationId, text }) => {
      await sendTextMessage(provider, { organizationId, conversationId, text, source: "ai_agent", sentByUserId: null });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    resolveImage: async (key) => (storage ? storage.signedGetUrl(key, 15 * 60) : null),
  };
}

export async function sweepOnce(queue: AgentQueuePort, kv: KvPort, now: Date): Promise<void> {
  const reactivated = await reactivateExpiredHandovers(now);
  if (reactivated) console.info(`[agente] barrido: ${reactivated} conversación(es) reactivada(s) tras pasar a humano`);
  const orphans = await findOrphanConversations(now);
  for (const o of orphans) await scheduleAgentRun(queue, kv, o, 0);
  if (orphans.length) console.info(`[agente] barrido: ${orphans.length} conversación(es) sin atender re-programada(s)`);
}

export function startAgentRuntime(opts: { provider: MessagingProvider; storage: ObjectStorage | null }) {
  const kv = redisKvPort();
  const queue = bullAgentQueuePort();
  const runDeps = makeRunDeps(opts.provider, opts.storage);
  const deps = {
    kv,
    now: runDeps.now,
    run: (conversationId: string) => runAgent(conversationId, runDeps),
    delayFor: debounceDelayFor,
  };
  const worker = new Worker<AgentJob>(
    AGENT_QUEUE,
    async (job, token) => {
      const { result, rescheduleMs } = await processAgentJob(job.data, deps);
      console.info(`[agente] ${job.data.conversationId}: ${describe(result)}`);
      if (rescheduleMs !== null && token) {
        // Mismo job (mismo jobId) de vuelta a "delayed": nunca dos por conversación.
        await job.moveToDelayed(Date.now() + rescheduleMs, token);
        throw new DelayedError();
      }
    },
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 5 },
  );
  worker.on("failed", (job, error) => {
    console.error(`[agente] falló ${job?.data.conversationId} (intento ${job?.attemptsMade}): ${error.message}`);
  });
  const timer = setInterval(() => {
    sweepOnce(queue, kv, new Date()).catch((error) => console.error("[agente] barrido falló", error));
  }, SWEEP_EVERY_MS);
  console.info(`[agente] escuchando ${AGENT_QUEUE}`);
  return {
    close: async () => {
      clearInterval(timer);
      await worker.close();
      await closeAgentConnections();
    },
  };
}
