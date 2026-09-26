// Consumer del Agente IA (Fase B). Mismo patrón que los programados
// (worker/scheduled.ts): se crea con autorun:false y worker/index.ts llama a
// run() cuando waitForMigrations confirma que la base ya tiene sus tablas.
import { DelayedError, Worker } from "bullmq";
import { callModel } from "@/lib/ai";
import { redisConnection } from "@/lib/queue/inbound";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { sendAgentText } from "@/lib/messaging/send";
import { startWorkflowRun } from "@/lib/workflows/executor";
import { transcriptionEnabled } from "@/lib/ai/transcription/transcribe";
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
import { isWithinSchedule } from "@/lib/agente-ia/opciones";
import { loadBotOptions } from "./options";
import { runAgent, type RunDeps, type RunResult } from "./run";
import { reactivateDuePauses } from "./pause";
import { debounceDelayFor } from "./schedule";
import { findLostRetries, findOrphanConversations, findPendingAtOpening, noticeFailedAgentSends, OPENING_STAGGER_MS, reconcileStuckDrafts } from "./sweep";

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
    // Id determinista por burbuja: "Reintentar" reenvía la misma fila sin duplicar.
    sendBubble: ({ organizationId, conversationId, text, messageId }) =>
      sendAgentText(provider, { organizationId, conversationId, text, messageId }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    resolveImage: async (key) => (storage ? storage.signedGetUrl(key, 15 * 60) : null),
    // Acciones del cerebro (Fase D): corridas de workflow con trigger "agent".
    startWorkflow: startWorkflowRun,
    // Parte 1: el agente espera la nota de voz solo si este worker la puede transcribir.
    transcriptionEnabled: storage !== null && transcriptionEnabled(),
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
  // Parte 1: "Reintentar" cuya corrida se perdió → se vuelve a programar (sin modelo).
  const lost = await findLostRetries(now);
  for (const o of lost) await scheduleAgentRun(queue, kv, o, 0);
  if (lost.length) console.info(`[agente] barrido: ${lost.length} reintento(s) de respuesta guardada re-programado(s)`);
  const orphans = await findOrphanConversations(now);
  for (const o of orphans) await scheduleAgentRun(queue, kv, o, 0);
  if (orphans.length) console.info(`[agente] barrido: ${orphans.length} conversación(es) sin atender re-programada(s)`);
  // Opciones del bot → horario: organizaciones con horario y ABIERTAS ahora: lo que quedó
  // sin respuesta (hasta 24 h) se programa escalonado (una cada 5 s, 12 por minuto), solo
  // si la conversación no tiene ya un job (así el barrido siguiente no lo empuja).
  const opening = await findPendingAtOpening(now);
  let scheduled = 0;
  for (const o of opening) {
    if (!isWithinSchedule((await loadBotOptions(o.organizationId, now)).schedule, now)) continue;
    if (await queue.getJob(o.conversationId)) continue;
    await scheduleAgentRun(queue, kv, o, scheduled * OPENING_STAGGER_MS);
    scheduled++;
  }
  if (scheduled) console.info(`[agente] barrido: ${scheduled} conversación(es) pendiente(s) al abrir el horario, repartida(s) cada ${OPENING_STAGGER_MS / 1000} s`);
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
