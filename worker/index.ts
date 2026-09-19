// Servicio `worker` (Railway, mismo repo que `web`; CLAUDE.md §4).
// Arranque: npx tsx worker/index.ts
//
// - Consume la cola de webhooks entrantes (BullMQ).
// - Consume la cola de descarga de media: copia cada adjunto recibido al
//   bucket propio antes de que Meta lo borre (lib/messaging/media.ts).
// - Barrido: cada minuto re-encola eventos guardados que nunca se procesaron
//   (p. ej. Redis no respondió cuando llegó el webhook), da por no confirmados los
//   envíos del CRM de resultado desconocido y re-encola media pendiente. La base es la
//   fuente de verdad; la cola solo acelera.
import { UnrecoverableError, Worker } from "bullmq";
import { and, asc, count, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, webhookEvents } from "@/lib/db/schema";
import { messagingProvider } from "@/lib/messaging";
import { DEAD_LETTER_ATTEMPTS, DeadLetterIngestError, PermanentIngestError, processWebhookEvent } from "@/lib/messaging/ingest";
import { downloadMessageMedia } from "@/lib/messaging/media";
import { MEDIA_MAX_ATTEMPTS, MEDIA_SWEEP_DAYS } from "@/lib/messaging/media-keys";
import { expireUnconfirmedSends } from "@/lib/messaging/send";
import {
  enqueueMediaDownload,
  INBOUND_QUEUE,
  MEDIA_QUEUE,
  redisConnection,
  reviveInbound,
  type InboundJob,
  type MediaJob,
} from "@/lib/queue/inbound";
import { objectStorage, StorageNotConfiguredError, type ObjectStorage } from "@/lib/storage/s3";

const SWEEP_EVERY_MS = 60_000;
const SWEEP_MIN_AGE_MS = 60_000;
const SWEEP_MAX_ATTEMPTS = DEAD_LETTER_ATTEMPTS;
// Retención de webhook_events PROCESADOS: traen datos crudos del cliente
// (teléfono, nombre, texto, URLs de media). Ya aplicados a las tablas del CRM,
// se conservan 30 días para reprocesar/depurar y luego se borran. Los NO
// procesados (dead-letter) NO se tocan: siguen disponibles para replay.
const WEBHOOK_RETENTION_DAYS = 30;

const provider = messagingProvider();

// La media es opcional para arrancar: sin bucket configurado, la ingesta de
// mensajes sigue funcionando y los adjuntos esperan en la base (el barrido los
// recoge en cuanto el bucket exista y el worker se reinicie).
function optionalStorage(): ObjectStorage | null {
  try {
    return objectStorage();
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    console.error(`[media] DESACTIVADA: ${error.message}. Los adjuntos quedan pendientes.`);
    return null;
  }
}
const storage = optionalStorage();
// Adjuntos pendientes que el barrido reintenta: hasta 30 días (antes de que
// Meta borre la media) y hasta MEDIA_MAX_ATTEMPTS intentos por adjunto.

const worker = new Worker<InboundJob>(
  INBOUND_QUEUE,
  async (job) => {
    try {
      const outcome = await processWebhookEvent(provider, job.data.webhookEventId, {
        onMediaMessage: enqueueMediaDownload,
      });
      console.info(`[worker] ${job.data.webhookEventId}: ${outcome}`);
      return outcome;
    } catch (error) {
      if (error instanceof PermanentIngestError || error instanceof DeadLetterIngestError) {
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

// Concurrencia baja: cada descarga va en streaming (memoria acotada por
// partes de 5 MB), pero comparte proceso con la ingesta.
const mediaWorker = storage
  ? new Worker<MediaJob>(
      MEDIA_QUEUE,
      async (job) => {
        const { stored, pending } = await downloadMessageMedia(provider, storage, job.data.messageId);
        console.info(`[media] ${job.data.messageId}: ${stored} guardado(s), ${pending} pendiente(s)`);
      },
      { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 2 },
    )
  : null;
mediaWorker?.on("failed", (job, error) => {
  console.error(`[media] falló ${job?.data.messageId} (intento ${job?.attemptsMade}): ${error.message}`);
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
  let revived = 0;
  for (const { id } of stale) {
    const result = await reviveInbound(id);
    if (result === "added" || result === "retried") revived++;
  }
  if (revived) console.info(`[worker] barrido: ${revived} evento(s) pendientes re-encolados`);

  // Dead-letter: agotaron los intentos y siguen sin procesar. Quedan crudos en
  // webhook_events (nada se pierde); replay con scripts/replay-webhook-events.ts.
  const [{ value: dead }] = await db
    .select({ value: count() })
    .from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), gte(webhookEvents.attempts, SWEEP_MAX_ATTEMPTS)));
  if (dead > 0) {
    console.error(`[worker] DEAD-LETTER: ${dead} evento(s) agotaron ${SWEEP_MAX_ATTEMPTS} intentos; revisar last_error y reprocesar`);
  }

  // Envíos del CRM de resultado desconocido que nunca se confirmaron.
  const unconfirmed = await expireUnconfirmedSends();
  if (unconfirmed) console.warn(`[worker] barrido: ${unconfirmed} envío(s) sin confirmar → failed (send_unconfirmed)`);

  // Retención: borra los eventos ya procesados de más de 30 días.
  const purged = await db
    .delete(webhookEvents)
    .where(
      and(
        isNotNull(webhookEvents.processedAt),
        lt(webhookEvents.processedAt, new Date(Date.now() - WEBHOOK_RETENTION_DAYS * 86_400_000)),
      ),
    )
    .returning({ id: webhookEvents.id });
  if (purged.length) console.info(`[worker] barrido: ${purged.length} webhook_event(s) procesados purgados (>${WEBHOOK_RETENTION_DAYS} d)`);

  if (!storage) return;
  // Media pendiente: mensajes con algún adjunto sin storageKey.
  const pendingMedia = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        gte(messages.createdAt, new Date(Date.now() - MEDIA_SWEEP_DAYS * 86_400_000)),
        lt(messages.createdAt, new Date(Date.now() - SWEEP_MIN_AGE_MS)),
        sql`exists (select 1 from jsonb_array_elements(${messages.attachments}) a
                    where a->>'storageKey' is null
                      and coalesce((a->>'downloadAttempts')::int, 0) < ${MEDIA_MAX_ATTEMPTS})`,
      ),
    )
    .limit(50);
  for (const { id } of pendingMedia) await enqueueMediaDownload(id);
  if (pendingMedia.length) console.info(`[worker] barrido: ${pendingMedia.length} mensaje(s) con media pendiente`);
}

const sweepTimer = setInterval(() => {
  sweep().catch((error) => console.error("[worker] barrido falló", error));
}, SWEEP_EVERY_MS);

async function shutdown(signal: string) {
  console.info(`[worker] ${signal}: cerrando`);
  clearInterval(sweepTimer);
  await Promise.all([worker.close(), mediaWorker?.close()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.info(
  `[worker] escuchando ${INBOUND_QUEUE}${mediaWorker ? ` y ${MEDIA_QUEUE}` : " (media desactivada)"} (proveedor ${provider.name})`,
);
