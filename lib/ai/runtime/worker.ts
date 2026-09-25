// Consumer del Agente IA (Fase B). Mismo patrón que los programados
// (worker/scheduled.ts): se crea con autorun:false y worker/index.ts llama a
// run() cuando waitForMigrations confirma que la base ya tiene sus tablas.
import { DelayedError, Worker } from "bullmq";
import { callModel } from "@/lib/ai";
import { redisConnection } from "@/lib/queue/inbound";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { sendTextMessage } from "@/lib/messaging/send";
import { startWorkflowRun } from "@/lib/workflows/executor";
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
import { reactivateDuePauses } from "./pause";
import { debounceDelayFor } from "./schedule";
import { findOrphanConversations, noticeFailedAgentSends, reconcileStuckDrafts } from "./sweep";

const SWEEP_EVERY_MS = 60_000;

function describe(result: RunResult | null): string {
  if (!result) return "candado ocupado, reintento";
  switch (result.kind) {
    case "sent":
      return `enviado (${result.bubbles} burbuja/s)`;
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
    sendBubble: ({ organizationId, conversationId, text }) =>
      sendTextMessage(provider, { organizationId, conversationId, text, source: "ai_agent", sentByUserId: null }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    resolveImage: async (key) => (storage ? storage.signedGetUrl(key, 15 * 60) : null),
    // Acciones del cerebro (Fase D): corridas de workflow con trigger "agent".
    startWorkflow: startWorkflowRun,
  };
}

export async function sweepOnce(queue: AgentQueuePort, kv: KvPort, now: Date): Promise<void> {
  // "Apagar bot" con hora cumplida → activo (corte = la hora de regreso). Va antes
  // que los huérfanos: lo que el cliente escribió durante la pausa queda atrás del corte.
  const back = await reactivateDuePauses(now);
  if (back) console.info(`[agente] barrido: bot reactivado en ${back} conversación(es) (se cumplió la hora de regreso)`);
  const failedSends = await noticeFailedAgentSends(now);
  if (failedSends) console.info(`[agente] barrido: ${failedSends} aviso(s) de envío del agente fallido o sin confirmar`);
  const plans = await reconcileStuckDrafts(now);
  if (plans) console.info(`[agente] barrido: ${plans} plan(es) de burbujas atorado(s) en "enviando" conciliado(s)`);
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
    run: (job: AgentJob) => runAgent(job, runDeps),
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
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 5, autorun: false },
  );
  worker.on("failed", (job, error) => {
    console.error(`[agente] falló ${job?.data.conversationId} (intento ${job?.attemptsMade}): ${error.message}`);
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    // Arranca el consumer y su barrido (pausas con hora cumplida, planes atorados,
    // avisos de envíos fallidos y conversaciones sin atender). Solo tras las migraciones.
    run: () => {
      void worker.run();
      timer = setInterval(() => {
        sweepOnce(queue, kv, new Date()).catch((error) => console.error("[agente] barrido falló", error));
      }, SWEEP_EVERY_MS);
      console.info(`[agente] escuchando ${AGENT_QUEUE}`);
    },
    close: async () => {
      if (timer) clearInterval(timer);
      await worker.close();
      await closeAgentConnections();
    },
  };
}
