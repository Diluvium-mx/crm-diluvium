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
import { waitForMigrations } from "@/lib/db/wait-for-migrations";
import { messages, webhookEvents } from "@/lib/db/schema";
import { messagingProvider } from "@/lib/messaging";
import {
  DEAD_LETTER_ATTEMPTS,
  DeadLetterIngestError,
  PermanentIngestError,
  processWebhookEvent,
  reopenResolvedOrphans,
} from "@/lib/messaging/ingest";
import { downloadMessageMedia } from "@/lib/messaging/media";
import { generateMessageThumbnails, THUMBNAIL_MAX_ATTEMPTS } from "@/lib/messaging/thumbnails";
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
import { inboundHealth, WORKER_HEARTBEAT_KEY } from "@/lib/monitoring/inbound-health";
import { redis } from "@/lib/redis";
import { startScheduledWorker } from "./scheduled";
import { agentIngestHooks } from "@/lib/ai/runtime/hooks";
import { startAgentRuntime } from "@/lib/ai/runtime/worker";
import { adsIngestHooks, startAdsWorker } from "@/lib/ads/worker";

const SWEEP_EVERY_MS = 60_000;
const SWEEP_MIN_AGE_MS = 60_000;
const SWEEP_MAX_ATTEMPTS = DEAD_LETTER_ATTEMPTS;
// Retención de webhook_events PROCESADOS: traen datos crudos del cliente
// (teléfono, nombre, texto, URLs de media). Ya aplicados a las tablas del CRM,
// se conservan 30 días para reprocesar/depurar y luego se borran. Los NO
// procesados (dead-letter) NO se tocan: siguen disponibles para replay.
const WEBHOOK_RETENTION_DAYS = 30;

const provider = messagingProvider();
// Mensajes programados (A6): cola diferida + su parte del barrido.
const scheduled = startScheduledWorker(provider);

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
// Agente IA (Fase B): cola de respuestas con debounce; arranca tras las migraciones.
const agent = startAgentRuntime({ provider, storage });
// Anuncios de Meta: media del anuncio, nombres de Meta y respaldo sin ficha.
const ads = startAdsWorker({ provider, storage });
// Adjuntos pendientes que el barrido reintenta: hasta 30 días (antes de que
// Meta borre la media) y hasta MEDIA_MAX_ATTEMPTS intentos por adjunto.

const worker = new Worker<InboundJob>(
  INBOUND_QUEUE,
  async (job) => {
    try {
      const outcome = await processWebhookEvent(provider, job.data.webhookEventId, {
        onMediaMessage: enqueueMediaDownload,
        ...agentIngestHooks,
        ...adsIngestHooks,
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
  // autorun: false → arranca cuando la base ya tiene las migraciones (abajo).
  { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 5, autorun: false },
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
        // Miniatura de PDF (tarjeta de documento): después de la descarga y
        // sin afectar el resultado del job (generateMessageThumbnails no lanza).
        const thumbs = await generateMessageThumbnails(storage, job.data.messageId);
        if (thumbs) console.info(`[media] ${job.data.messageId}: ${thumbs} miniatura(s)`);
      },
      { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 2, autorun: false },
    )
  : null;
mediaWorker?.on("failed", (job, error) => {
  console.error(`[media] falló ${job?.data.messageId} (intento ${job?.attemptsMade}): ${error.message}`);
});

// Hasta que la base tenga la última migración del código, ni colas ni barrido.
let migrationsReady = false;

async function sweep() {
  if (!migrationsReady) return;

  // Latido para el monitoreo externo (/api/health/inbound): si el worker cae
  // (o se queda esperando migraciones), deja de actualizarse y la GitHub Action
  // avisa aunque aquí no corra nada.
  await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "EX", 3_600).catch((error: unknown) => {
    console.error("[monitor] no se pudo escribir el latido en Redis", error);
  });

  // Huérfanos (estado/reacción/edición sin su mensaje) cuyo mensaje ya llegó:
  // vuelven a pendientes y se procesan en este mismo barrido.
  const reopened = await reopenResolvedOrphans();
  if (reopened) console.info(`[worker] barrido: ${reopened} evento(s) huérfanos reabiertos (su mensaje ya existe)`);

  // Mensajes programados (A6): vencidos sin job y envíos atorados.
  await scheduled.sweep().catch((error) => console.error("[scheduled] barrido falló", error));
  // Anuncios: clics sin registrar, media pendiente y nombres de Meta.
  await ads.sweep().catch((error) => console.error("[anuncios] barrido falló", error));

  const stale = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        // La cuarentena (cuenta no permitida) no se procesa hasta liberarla.
        isNull(webhookEvents.quarantinedAt),
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
  // webhook_events (nada se pierde) y se MARCAN en la BD (dead_lettered_at) la
  // primera vez, para el monitoreo; replay con scripts/replay-webhook-events.ts.
  const newlyDead = await db
    .update(webhookEvents)
    .set({ deadLetteredAt: new Date() })
    .where(
      and(
        isNull(webhookEvents.processedAt),
        isNull(webhookEvents.deadLetteredAt),
        isNull(webhookEvents.quarantinedAt),
        gte(webhookEvents.attempts, SWEEP_MAX_ATTEMPTS),
      ),
    )
    .returning({ id: webhookEvents.id, event: webhookEvents.event, lastError: webhookEvents.lastError });
  for (const row of newlyDead) {
    console.error(`[worker] DEAD-LETTER nuevo: ${row.id} (${row.event}): ${row.lastError ?? "sin error registrado"}`);
  }
  const [{ value: dead }] = await db
    .select({ value: count() })
    .from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), isNotNull(webhookEvents.deadLetteredAt)));
  if (dead > 0) {
    console.error(`[worker] DEAD-LETTER: ${dead} evento(s) sin procesar; revisar last_error y reprocesar`);
  }

  // Envíos del CRM de resultado desconocido que nunca se confirmaron.
  const unconfirmed = await expireUnconfirmedSends();
  if (unconfirmed) console.warn(`[worker] barrido: ${unconfirmed} envío(s) sin confirmar → failed (send_unconfirmed)`);

  const [{ value: quarantined }] = await db
    .select({ value: count() })
    .from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), isNotNull(webhookEvents.quarantinedAt)));
  if (quarantined > 0) {
    console.error(
      `[worker] CUARENTENA: ${quarantined} evento(s) de cuentas no permitidas en este entorno; ` +
        "revisar ZERNIO_ALLOWED_ACCOUNT_IDS y liberar con scripts/replay-webhook-events.ts",
    );
  }

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
  // La cuarentena también caduca a los 30 días: son datos crudos de una cuenta
  // ajena a este entorno; si en 30 días nadie la liberó, no era de aquí.
  await db
    .delete(webhookEvents)
    .where(
      and(
        isNotNull(webhookEvents.quarantinedAt),
        lt(webhookEvents.quarantinedAt, new Date(Date.now() - WEBHOOK_RETENTION_DAYS * 86_400_000)),
      ),
    );

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

  // Miniaturas de PDF que faltan (ya descargados; pocos intentos por adjunto).
  const pendingThumbs = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        gte(messages.createdAt, new Date(Date.now() - MEDIA_SWEEP_DAYS * 86_400_000)),
        sql`exists (select 1 from jsonb_array_elements(${messages.attachments}) a
                    where a->>'storageKey' is not null and a->>'thumbnailKey' is null
                      and (a->>'mimeType' = 'application/pdf' or a->>'fileName' ilike '%.pdf')
                      and coalesce((a->>'thumbnailAttempts')::int, 0) < ${THUMBNAIL_MAX_ATTEMPTS})`,
      ),
    )
    .limit(10);
  for (const { id } of pendingThumbs) await generateMessageThumbnails(storage, id);
}

// Sin barridos solapados: si uno tarda más de un minuto, el siguiente espera.
let sweeping = false;
const sweepTimer = setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  sweep()
    .catch((error) => console.error("[worker] barrido falló", error))
    .finally(() => {
      sweeping = false;
    });
}, SWEEP_EVERY_MS);

// Monitoreo del go-live (cada 5 min): la misma revisión que usa la GitHub
// Action. Al log de Railway como [monitor] ALERTA; la Action es el aviso que
// llega por correo aunque este proceso esté caído.
const MONITOR_EVERY_MS = 5 * 60_000;
async function monitor() {
  if (!migrationsReady) return;
  const report = await inboundHealth({
    heartbeatAgeSeconds: async () => 0, // este mismo proceso está vivo
    checkZernio: false, // lo revisa el web (/api/health/inbound), que tiene APP_URL
  });
  if (report.ok) console.info("[monitor] entrada de WhatsApp sana");
  else console.error(`[monitor] ALERTA: ${report.problems.join(" · ")}`);
}
const monitorTimer = setInterval(() => {
  monitor().catch((error) => console.error("[monitor] la revisión falló", error));
}, MONITOR_EVERY_MS);

async function shutdown(signal: string) {
  console.info(`[worker] ${signal}: cerrando`);
  clearInterval(sweepTimer);
  clearInterval(monitorTimer);
  await Promise.all([worker.close(), mediaWorker?.close(), scheduled.close(), agent.close(), ads.close()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.info(
  `[worker] escuchando ${INBOUND_QUEUE}${mediaWorker ? ` y ${MEDIA_QUEUE}` : " (media desactivada)"} (proveedor ${provider.name})`,
);

waitForMigrations()
  .then(() => {
    migrationsReady = true;
    console.info("[worker] migraciones al día: arrancan las colas");
    void worker.run();
    void mediaWorker?.run();
    scheduled.run();
    agent.run();
    ads.run();
  })
  .catch((error: unknown) => {
    console.error("[worker] no se pudo verificar las migraciones", error);
    process.exit(1);
  });
