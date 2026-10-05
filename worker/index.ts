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
import { and, asc, count, desc, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logError, safeErrorMessage } from "@/lib/log/safe-error";
import { waitForMigrations } from "@/lib/db/wait-for-migrations";
import { messages, webhookEvents } from "@/lib/db/schema";
import { messagingProvider } from "@/lib/messaging";
import {
  DEAD_LETTER_ATTEMPTS,
  DeadLetterIngestError,
  PermanentIngestError,
  processWebhookEvent,
  releaseQuarantinedStatuses,
  reopenResolvedOrphans,
} from "@/lib/messaging/ingest";
import { downloadMessageMedia } from "@/lib/messaging/media";
import { generateMessageThumbnails, THUMBNAIL_MAX_ATTEMPTS } from "@/lib/messaging/thumbnails";
import { HISTORY_MEDIA_PER_SWEEP, MEDIA_MAX_ATTEMPTS, MEDIA_SWEEP_DAYS } from "@/lib/messaging/media-keys";
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
import { checkWhatsappAccounts, describeSummary } from "@/lib/monitoring/account-health";
import { recordUncheckedStreak } from "@/lib/monitoring/unchecked-streak";
import { backlogText } from "@/lib/monitoring/bot-status";
import { redis } from "@/lib/redis";
import { startScheduledWorker } from "./scheduled";
import { startWorkflowWorker } from "./workflows";
import { startOutboxWorker } from "./outbox";
import { startChatUploadWorker } from "./chat-uploads";
import { onInboundKeyword } from "@/lib/workflows/triggers";
import { agentIngestHooks, wakeAgentAfterTranscription } from "@/lib/ai/runtime/hooks";
import { closeInterruptedTranscriptions, staleTranscriptionIds, transcribeMessageAudio } from "@/lib/ai/transcription/transcribe";
import { startAgentRuntime } from "@/lib/ai/runtime/worker";
import { startLectorRuntime } from "@/lib/ai/runtime/lector-worker";
import { startFollowUpRuntime } from "@/lib/followups/store";
import { keepBrainCacheAlive } from "@/lib/ai/runtime/cache-keepalive";
import { redisKvPort } from "@/lib/ai/runtime/queue";
import { callModel } from "@/lib/ai";
import { adsIngestHooks, startAdsWorker } from "@/lib/ads/worker";
import { enqueueUnavailableCheck } from "@/lib/queue/unavailable";
import { startUnavailableWorker } from "./unavailable";
import { syncAiBilling } from "@/lib/ai/billing/sync";
import { syncMetaBilling } from "@/lib/meta-billing/sync";
import { refreshTemplatesInReview } from "@/lib/messaging/templates";
import { actualizarClima } from "@/lib/clima/sync";

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
// Lector en segundo plano (28-sep-2026): etapa y Detalle del contacto al día aunque el
// Agente IA esté apagado o pausado; nunca le escribe al cliente. Arranca tras las migraciones.
const lector = startLectorRuntime({
  now: () => new Date(),
  callModel,
  resolveImage: async (key) => (storage ? storage.signedGetUrl(key, 15 * 60) : null),
  kv: redisKvPort(),
});
// Seguimientos (2-oct-2026, Parte 1 en MODO ENSAYO): cada minuto anota cuándo "habría salido"
// cada intento y programa el siguiente; no le manda nada al cliente. Arranca tras las migraciones.
const followUps = startFollowUpRuntime();
// Workflows (Fase D): corridas de acciones (media, etapa, humano, avisos).
const workflowsRunner = startWorkflowWorker(provider, storage);
// Envíos del web en fila de espera (Bloque B): 429 de Zernio o turno de la conversación.
const outbox = startOutboxWorker(provider);
// Anuncios de Meta: media del anuncio, nombres de Meta y respaldo sin ficha.
const ads = startAdsWorker({ provider, storage });
// Doble verificación del aviso "no disponible" (caso SDA, 29-sep-2026): recuperado de
// Zernio = entrante nuevo (Agente IA y palabras clave); confirmado sin contenido = solo
// el Agente IA (responde con el texto fijo; ninguna palabra clave puede venir de un aviso).
const unavailable = startUnavailableWorker(provider, {
  onMediaMessage: enqueueMediaDownload,
  onRecovered: async (m) => {
    await agentIngestHooks.onInboundMessage?.(m);
    await onInboundKeyword(m);
  },
  onConfirmedUnavailable: async (m) => {
    await agentIngestHooks.onInboundMessage?.(m);
  },
});
// Adjuntos del chat (28-sep-2026): solo con bucket (los archivos viven ahí).
const chatUploads = storage ? startChatUploadWorker(provider, storage) : null;
// Adjuntos pendientes que el barrido reintenta: hasta 30 días (antes de que
// Meta borre la media) y hasta MEDIA_MAX_ATTEMPTS intentos por adjunto.

const worker = new Worker<InboundJob>(
  INBOUND_QUEUE,
  async (job) => {
    try {
      const outcome = await processWebhookEvent(provider, job.data.webhookEventId, {
        onMediaMessage: enqueueMediaDownload,
        ...agentIngestHooks,
        // Fase D: palabra clave del cliente → workflow. Corre DESPUÉS del gancho
        // del agente y aislado (nunca lanza): un fallo no re-encola la ingesta.
        onInboundMessage: async (m) => {
          await agentIngestHooks.onInboundMessage?.(m);
          await onInboundKeyword(m);
        },
        ...adsIngestHooks,
        onUnavailableNotice: enqueueUnavailableCheck,
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
  console.error(`[worker] falló ${job?.data.webhookEventId} (intento ${job?.attemptsMade}): ${safeErrorMessage(error)}`);
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
        // Nota de voz del cliente (Agente IA parte 1): se transcribe en cuanto está en el
        // bucket y se despierta al agente que la esperaba. Nunca lanza.
        await transcribeAndWake(storage, job.data.messageId);
      },
      { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 2, autorun: false },
    )
  : null;
async function transcribeAndWake(bucket: ObjectStorage, messageId: string): Promise<void> {
  const t = await transcribeMessageAudio(bucket, messageId);
  if (t.kind !== "terminada") return;
  if (t.estado !== "lista") console.info(`[transcripcion] ${messageId}: ${t.estado}${t.motivo ? ` (${t.motivo})` : ""}`);
  await wakeAgentAfterTranscription({ organizationId: t.organizationId, conversationId: t.conversationId });
}

mediaWorker?.on("failed", (job, error) => {
  console.error(`[media] falló ${job?.data.messageId} (intento ${job?.attemptsMade}): ${safeErrorMessage(error)}`);
});

// Hasta que la base tenga la última migración del código, ni colas ni barrido.
let migrationsReady = false;

async function sweep() {
  if (!migrationsReady) return;

  // Latido para el monitoreo externo (/api/health/inbound): si el worker cae
  // (o se queda esperando migraciones), deja de actualizarse y la GitHub Action
  // avisa aunque aquí no corra nada.
  await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "EX", 3_600).catch((error: unknown) => {
    logError("[monitor] no se pudo escribir el latido en Redis", error);
  });

  // Huérfanos (estado/reacción/edición sin su mensaje) cuyo mensaje ya llegó:
  // vuelven a pendientes y se procesan en este mismo barrido.
  const reopened = await reopenResolvedOrphans();
  if (reopened) console.info(`[worker] barrido: ${reopened} evento(s) huérfanos reabiertos (su mensaje ya existe)`);
  // Estados sin cuenta que llegaron antes que su mensaje (cuarentena con wamid): ya tienen mensaje.
  const released = await releaseQuarantinedStatuses();
  if (released) console.info(`[worker] barrido: ${released} estado(s) liberados de cuarentena (su mensaje ya existe)`);

  // Mensajes programados (A6): vencidos sin job y envíos atorados.
  await scheduled.sweep().catch((error) => logError("[scheduled] barrido falló", error));
  await workflowsRunner.sweep().catch((error) => logError("[workflows] barrido falló", error));
  await outbox.sweep().catch((error) => logError("[outbox] barrido falló", error));
  // Anuncios: clics sin registrar, media pendiente y nombres de Meta.
  await ads.sweep().catch((error) => logError("[anuncios] barrido falló", error));
  await unavailable.sweep().catch((error) => logError("[no-disponible] barrido falló", error));
  await chatUploads?.sweep().catch((error) => logError("[adjuntos] barrido falló", error));
  // Caché de 1 h del Agente IA viva de 7:00 a 22:00 (2-oct-2026): ~US$0.004 por renovación.
  await keepBrainCacheAlive({ callModel }).catch((error) => logError("[cache] la renovación de la caché falló", error));

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
  // Media pendiente: mensajes con algún adjunto sin storageKey. Primero los vivos; el
  // historial del celular va poco a poco (HISTORY_MEDIA_PER_SWEEP por minuto, lo más
  // reciente primero) para no gastar el límite de Zernio que usan los envíos.
  const pendingMediaWhere = and(
    gte(messages.createdAt, new Date(Date.now() - MEDIA_SWEEP_DAYS * 86_400_000)),
    lt(messages.createdAt, new Date(Date.now() - SWEEP_MIN_AGE_MS)),
    // Sin copia, o con una copia VACÍA (0 bytes; Bloque B): se vuelve a bajar.
    sql`exists (select 1 from jsonb_array_elements(${messages.attachments}) a
                where (a->>'storageKey' is null or a->>'sizeBytes' = '0')
                  and coalesce((a->>'downloadAttempts')::int, 0) < ${MEDIA_MAX_ATTEMPTS})`,
  );
  const pendingMedia = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(pendingMediaWhere, isNull(messages.importedAt)))
    .limit(50);
  const pendingHistoryMedia = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(pendingMediaWhere, isNotNull(messages.importedAt)))
    .orderBy(desc(messages.sentAt))
    .limit(HISTORY_MEDIA_PER_SWEEP);
  for (const { id } of [...pendingMedia, ...pendingHistoryMedia]) await enqueueMediaDownload(id);
  if (pendingMedia.length) console.info(`[worker] barrido: ${pendingMedia.length} mensaje(s) con media pendiente`);
  if (pendingHistoryMedia.length) console.info(`[worker] barrido: ${pendingHistoryMedia.length} adjunto(s) del historial del celular en cola`);

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

  // Transcripciones que quedaron a medias (worker reiniciado): solo audios nuevos.
  for (const id of await staleTranscriptionIds(new Date())) await transcribeAndWake(storage, id);
  // Las que ya habían llamado a OpenAI y se cortaron: "fallida", sin volver a pagar.
  const cortadas = await closeInterruptedTranscriptions(new Date());
  if (cortadas) console.warn(`[transcripcion] barrido: ${cortadas} transcripción(es) interrumpida(s) cerrada(s) sin volver a llamar`);
}

// Sin barridos solapados: si uno tarda más de un minuto, el siguiente espera.
let sweeping = false;
const sweepTimer = setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  sweep()
    .catch((error) => logError("[worker] barrido falló", error))
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
    // Cuenta de WhatsApp en Zernio (desconexión): a cualquier hora; guarda el resultado en Redis.
    whatsappAccounts: () => checkWhatsappAccounts({ source: "worker" }),
    // "No se pudo revisar" solo es ALERTA tras 2 revisiones seguidas de este vigilante.
    uncheckedStreak: (check, failed) => recordUncheckedStreak("worker", check, failed),
  });
  const accounts = report.metrics.whatsappAccounts;
  const bot = report.metrics.bot;
  const summary =
    (accounts ? ` · cuentas de WhatsApp: ${describeSummary(accounts)}` : "") +
    (bot ? ` · Agente IA: ${bot.waiting} conversación(es) de la última hora sin respuesta · ${backlogText(bot.backlog)}` : "");
  for (const notice of report.notices) console.warn(`[monitor] aviso: ${notice}`);
  if (report.ok) console.info(`[monitor] entrada de WhatsApp sana${summary}`);
  else console.error(`[monitor] ALERTA: ${report.problems.join(" · ")}${summary}`);
}
const monitorTimer = setInterval(() => {
  monitor().catch((error) => logError("[monitor] la revisión falló", error));
}, MONITOR_EVERY_MS);

// Gasto de IA REAL (1-oct-2026): cada 5 min se leen los reportes de cobro de los proveedores con
// llave de administración (lib/ai/billing/sync.ts). Solo lee reportes: no gasta saldo. Sin
// lecturas solapadas: si una tarda más de 5 min, la siguiente espera.
const BILLING_EVERY_MS = 5 * 60_000;
let billingRunning = false;
function billing() {
  if (!migrationsReady || billingRunning) return;
  billingRunning = true;
  syncAiBilling()
    .catch((error) => logError("[gasto-ia] la lectura del cobro real falló", error))
    .finally(() => {
      billingRunning = false;
    });
}
const billingTimer = setInterval(billing, BILLING_EVERY_MS);

// Cobro de Meta por WhatsApp (5-oct-2026): cada hora se lee pricing_analytics de la WABA
// (lib/meta-billing/sync.ts), y una vez al arrancar. Sin META_WHATSAPP_TOKEN/META_WABA_ID no hace nada.
const META_BILLING_EVERY_MS = 60 * 60_000;
let metaBillingRunning = false;
function metaBilling() {
  if (!migrationsReady || metaBillingRunning) return;
  metaBillingRunning = true;
  syncMetaBilling()
    .catch((error) => logError("[meta-whatsapp] la lectura del cobro falló", error))
    .finally(() => {
      metaBillingRunning = false;
    });
}
const metaBillingTimer = setInterval(metaBilling, META_BILLING_EVERY_MS);

// Plantillas al día solas (1-oct-2026): mientras alguna esté «En revisión», cada 10 min se le
// pregunta a Meta su estado (lo mismo que «Ver estado»). Sin plantillas en revisión no consulta nada.
const TEMPLATES_EVERY_MS = 10 * 60_000;
let templatesRunning = false;
function templatesInReview() {
  if (!migrationsReady || templatesRunning) return;
  templatesRunning = true;
  refreshTemplatesInReview()
    .then((n) => {
      if (n) console.info(`[plantillas] estado revisado en Meta para ${n} organización(es)`);
    })
    .catch((error) => logError("[plantillas] la revisión del estado falló", error))
    .finally(() => {
      templatesRunning = false;
    });
}
const templatesTimer = setInterval(templatesInReview, TEMPLATES_EVERY_MS);

// Cinta del clima de la barra (2-oct-2026): cada 5 min se revisa si toca; trae el clima medido de
// aeropuertos y observatorios del SMN una vez por hora, solo en horario de trabajo (lib/clima/sync.ts).
// No usa base ni colas: deja la foto en Redis. Sin consultas solapadas.
const CLIMA_EVERY_MS = 5 * 60_000;
let climaRunning = false;
function clima() {
  if (climaRunning) return;
  climaRunning = true;
  actualizarClima()
    .catch((error) => logError("[clima] no se pudo traer el clima", error))
    .finally(() => {
      climaRunning = false;
    });
}
const climaTimer = setInterval(clima, CLIMA_EVERY_MS);

// Apagado ORDENADO (28-sep-2026, revisión completa B8/B9): en cada despliegue Railway manda SIGTERM al
// worker viejo y, pasado RAILWAY_DEPLOYMENT_DRAINING_SECONDS (variable del servicio; sin ella son 0 s),
// SIGKILL. Aquí se deja de tomar trabajo nuevo y se espera a que termine lo que está en curso (una
// respuesta del Agente IA a medias, una corrida, una descarga). Para que la señal llegue sin
// intermediarios, start:worker arranca con `exec node --import tsx` (sin `sh` ni el proceso de tsx
// en medio); el candado `shuttingDown` evita cerrar dos veces si llega por dos caminos.
// Lo que no alcance a terminar lo retoman, como siempre, la cola y los barridos.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  const t0 = Date.now();
  console.info(`[worker] ${signal}: cerrando (se termina lo que está en curso; no se toma trabajo nuevo)`);
  clearInterval(sweepTimer);
  clearInterval(monitorTimer);
  clearInterval(billingTimer);
  clearInterval(metaBillingTimer);
  clearInterval(templatesTimer);
  clearInterval(climaTimer);
  await Promise.all([worker.close(), mediaWorker?.close(), scheduled.close(), agent.close(), lector.close(), followUps.close(), workflowsRunner.close(), outbox.close(), ads.close(), unavailable.close(), chatUploads?.close()]);
  console.info(`[worker] cerrado en orden en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
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
    // Primera revisión del monitoreo ya, sin esperar 5 min (la pastilla del Dashboard sale al día tras un deploy).
    monitor().catch((error) => logError("[monitor] la revisión falló", error));
    // Y la primera lectura del gasto real (la tarjeta del Dashboard sale al día tras un deploy).
    billing();
    // Y el clima de la cinta (si es horario de trabajo y la foto ya tiene más de una hora).
    clima();
    metaBilling();
    void worker.run();
    void mediaWorker?.run();
    scheduled.run();
    agent.run();
    lector.run();
    followUps.run();
    workflowsRunner.run();
    outbox.run();
    ads.run();
    unavailable.run();
    chatUploads?.run();
  })
  .catch((error: unknown) => {
    logError("[worker] no se pudo verificar las migraciones", error);
    process.exit(1);
  });
