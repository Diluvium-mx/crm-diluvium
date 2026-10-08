// Envíos del web en fila de espera (Bloque B, 28-sep-2026): consume la cola y,
// en el barrido de cada minuto, re-encola los diferidos que perdieron su job
// (Redis caído al encolar, job fallido). La base es la fuente de verdad.
import { Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumeDeferredSend } from "@/lib/messaging/send";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { redisConnection } from "@/lib/queue/inbound";
import { enqueueOutboxSend, OUTBOX_QUEUE, outboxJobId, type OutboxJob } from "@/lib/queue/outbox";
import { logError, safeErrorMessage } from "@/lib/log/safe-error";

export function startOutboxWorker(provider: MessagingProvider) {
  const worker = new Worker<OutboxJob>(
    OUTBOX_QUEUE,
    async (job) => {
      const outcome = await resumeDeferredSend(provider, job.data);
      console.info(`[outbox] ${job.data.messageId}: ${outcome ? outcome.status : "ya resuelto"}`);
      return outcome?.status ?? "noop";
    },
    // Un envío que espera un 429 ocupa su lugar hasta 5 min: varios a la vez
    // para que la espera de una conversación no frene a las demás.
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 10, autorun: false },
  );
  worker.on("failed", (job, error) => {
    console.error(`[outbox] falló ${job?.data.messageId} (intento ${job?.attemptsMade}): ${safeErrorMessage(error)}`);
  });
  const queue = new Queue<OutboxJob>(OUTBOX_QUEUE, { connection: { ...redisConnection(), maxRetriesPerRequest: 1 } });

  async function sweep() {
    // Diferidos cuya marca venció sin que el worker los tomara: sin job o job fallido.
    const lost = await db.execute<{ id: string; organization_id: string }>(sql`
      select id, organization_id from messages
      where direction = 'out' and status = 'queued' and error_code is null
        and provider_message_id is null and provider_internal_id is null
        and metadata->'envio'->>'diferido' = 'true'
        and (metadata->'envio'->>'hasta') ~ '^[0-9]+$'
        and (metadata->'envio'->>'hasta')::bigint < ${Date.now()}
      order by created_at
      limit 50`);
    let revived = 0;
    for (const row of lost) {
      try {
        const job = await queue.getJob(outboxJobId(row.id));
        const state = job ? await job.getState() : "missing";
        if (state === "failed") await job!.retry("failed");
        else if (state === "missing" || state === "completed" || state === "unknown") {
          await job?.remove();
          // Sin corte de lectura: el vendedor ya vio lo suyo cuando lo escribió.
          await enqueueOutboxSend({ messageId: row.id, organizationId: row.organization_id, readCutoffMessageId: null, delayMs: 0 });
        } else continue;
        revived++;
      } catch (error) {
        logError(`[outbox] barrido no pudo revisar ${row.id}`, error);
      }
    }
    if (revived) console.info(`[outbox] barrido: ${revived} envío(s) en espera re-encolados`);
  }

  return { worker, sweep, run: () => void worker.run(), close: () => Promise.all([worker.close(), queue.close()]) };
}
