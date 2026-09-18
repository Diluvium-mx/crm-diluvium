// Servicio `worker` (Railway, mismo repo que `web`; CLAUDE.md §4).
// Arranque: npx tsx worker/index.ts
//
// - Consume la cola de webhooks entrantes (BullMQ).
// - Barrido: cada minuto re-encola eventos guardados que nunca se procesaron
//   (p. ej. Redis no respondió cuando llegó el webhook). La base es la fuente
//   de verdad; la cola solo acelera.
import { UnrecoverableError, Worker } from "bullmq";
import { and, asc, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { messagingProvider } from "@/lib/messaging";
import { PermanentIngestError, processWebhookEvent } from "@/lib/messaging/ingest";
import { enqueueInbound, INBOUND_QUEUE, redisConnection, type InboundJob } from "@/lib/queue/inbound";

const SWEEP_EVERY_MS = 60_000;
const SWEEP_MIN_AGE_MS = 60_000;
const SWEEP_MAX_ATTEMPTS = 20;

const provider = messagingProvider();

const worker = new Worker<InboundJob>(
  INBOUND_QUEUE,
  async (job) => {
    try {
      const outcome = await processWebhookEvent(provider, job.data.webhookEventId);
      console.info(`[worker] ${job.data.webhookEventId}: ${outcome}`);
      return outcome;
    } catch (error) {
      if (error instanceof PermanentIngestError) {
        console.error(`[worker] ${job.data.webhookEventId}: error permanente: ${error.message}`);
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  },
  // BullMQ exige maxRetriesPerRequest: null en la conexión del Worker.
  { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 5 },
);

worker.on("failed", (job, error) => {
  console.error(`[worker] falló ${job?.data.webhookEventId} (intento ${job?.attemptsMade}): ${error.message}`);
});

async function sweep() {
  const stale = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        lt(webhookEvents.receivedAt, new Date(Date.now() - SWEEP_MIN_AGE_MS)),
        lt(webhookEvents.attempts, SWEEP_MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(webhookEvents.receivedAt))
    .limit(100);
  for (const { id } of stale) await enqueueInbound(id);
  if (stale.length) console.info(`[worker] barrido: ${stale.length} evento(s) pendientes re-encolados`);
}

const sweepTimer = setInterval(() => {
  sweep().catch((error) => console.error("[worker] barrido falló", error));
}, SWEEP_EVERY_MS);

async function shutdown(signal: string) {
  console.info(`[worker] ${signal}: cerrando`);
  clearInterval(sweepTimer);
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.info(`[worker] escuchando ${INBOUND_QUEUE} (proveedor ${provider.name})`);
