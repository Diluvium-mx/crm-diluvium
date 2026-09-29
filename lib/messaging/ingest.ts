// Aplica un evento normalizado a la base (lo usa el worker). Toda consulta
// filtra por organización: la organización sale del CANAL (el número de
// WhatsApp conectado), nunca del payload.
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, not, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactsImportLockKey } from "@/lib/db/locks";
import { withTxRetry } from "@/lib/db/retry";
import { channels, contacts, conversations, messages, webhookEvents } from "@/lib/db/schema";
import { countryFromPhone, normalizePhone, phoneColumns, phoneLookupVariants } from "@/lib/phone";
import type {
  MessagingProvider,
  NormalizedMessageChangeEvent,
  NormalizedMessageEvent,
  NormalizedReactionEvent,
  NormalizedStatusEvent,
  ProviderName,
} from "./provider";
import { firstResponseSeconds, nextStatus, windowExpiresAt } from "./rules";
import { noticeWorkflowSendFailed, type FailedOutbound } from "@/lib/workflows/delivery-notice";
import { ingestHistoryMessage, isPhoneHistory } from "./history";
import { markKeywordPending } from "@/lib/workflows/keyword-pending";
import {
  completedMetadata,
  hiddenNoticeSql,
  isUnavailableNotice,
  NO_DISPONIBLE_KEY,
  noDisponibleEstado,
  resolvedMetadata,
  SHADOW_AFTER_MS,
  SHADOW_BEFORE_MS,
  UNAVAILABLE_CODE,
  unavailableCode,
  verifyingMetadata,
} from "./unavailable";
import { adoptLateEcho } from "./late-echo";
import { pendingFallbackNote, recordAdClickSafely, type FallbackJob, type RecordedClick } from "@/lib/ads/attribution";
import { looksLikeAdMessage } from "@/lib/ads/referral";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Error que no se arregla reintentando (el evento queda marcado, no se reintenta). */
export class PermanentIngestError extends Error {}
/** Error transitorio: BullMQ reintenta con backoff (p. ej. estado que llegó antes que su mensaje). */
export class RetryableIngestError extends Error {}
/**
 * Evento que el CRM debería procesar pero no entiende (formato cambiado): NO
 * se reintenta a ciegas ni se da por procesado; va directo a dead-letter
 * (processed_at nulo, attempts = DEAD_LETTER_ATTEMPTS) para revisarlo y
 * reprocesarlo con scripts/replay-webhook-events.ts tras ajustar el adaptador.
 */
export class DeadLetterIngestError extends Error {}

/**
 * Regla del dueño (NINGÚN contacto duplicado): el teléfono de un chat del historial
 * del celular coincide con MÁS de un contacto. No se adivina a cuál pegarlo: el chat
 * no se importa y se reporta (por webhook queda en dead-letter, visible en el
 * monitoreo). Vive aquí y no en history.ts para no heredar de una clase a medio
 * cargar (history.ts e ingest.ts se importan entre sí).
 */
export class AmbiguousContactError extends DeadLetterIngestError {
  constructor(
    /** Teléfono o BSUID completo: solo para el reporte local del importador (.historial/). */
    readonly identity: string,
    readonly contactIds: string[],
  ) {
    // El mensaje llega a los logs del worker y a Redis: sin el teléfono completo (los
    // ids de los contactos bastan para encontrar el duplicado).
    super(`historial: …${identity.slice(-4)} coincide con ${contactIds.length} contactos (${contactIds.join(", ")}); no se adivina, revisar para fusionar`);
  }
}

/** Intentos a partir de los cuales un evento pendiente se considera dead-letter. */
export const DEAD_LETTER_ATTEMPTS = 20;

/**
 * Un estado, reacción o edición cuyo mensaje el CRM no tiene se reintenta
 * (puede llegar antes que el mensaje); pasado este tiempo desde que se recibió
 * se da por procesado como "ignorado" en vez de acabar en dead-letter: es un
 * mensaje que nunca pasó por el CRM (p. ej. anterior a conectar el número).
 */
export const ORPHAN_GRACE_MS = 10 * 60_000;

/**
 * Eco de un envío que aún no se puede atribuir: sin teléfono ni BSUID, con una conversación de
 * Zernio que el CRM no conoce y sin la fila propia enlazada todavía (el eco llegó antes de que la
 * respuesta del POST guardara los ids). Se REINTENTA: en segundos la fila ya tiene sus ids y el eco
 * se atribuye. Pasado ECHO_LINK_GRACE_MS desde que se recibió, dead-letter como antes (revisión
 * completa Z1, 28-sep-2026).
 */
export class UnattributedEchoError extends RetryableIngestError {}
export const ECHO_LINK_GRACE_MS = ORPHAN_GRACE_MS;

/**
 * El mensaje al que apunta el evento no existe (todavía). `awaiting` = el wamid
 * que espera, o "internal:<id>" si el estado solo trae el id interno.
 */
class OrphanEventError extends RetryableIngestError {
  constructor(
    message: string,
    readonly awaiting: string | null,
    /** Organización del canal: la reapertura exige que el mensaje sea de ella. */
    readonly organizationId: string | null,
  ) {
    super(message);
  }
}

/** Llave con la que un huérfano cerrado espera a su mensaje (webhook_events.orphan_wamid). */
export function orphanKey(ids: { providerMessageId?: string | null; providerInternalId?: string | null }): string | null {
  if (ids.providerMessageId) return ids.providerMessageId;
  return ids.providerInternalId ? `internal:${ids.providerInternalId}` : null;
}

export type IngestHooks = {
  /** Se llama (después del commit) con cada mensaje nuevo que trae adjuntos. */
  onMediaMessage?: (messageId: string) => Promise<void> | void;
  /** Agente IA: (después del commit) cada ENTRANTE NUEVO del cliente; no duplicados. */
  onInboundMessage?: (m: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    receivedAt: Date;
  }) => Promise<void> | void;
  /** Agente IA: (después del commit) cada eco NUEVO escrito por un humano desde el celular (business_app). */
  onHumanOutbound?: (m: { organizationId: string; conversationId: string }) => Promise<void> | void;
  /** Anuncios: (después del commit) cada clic NUEVO registrado (media del anuncio y nombres de Meta). */
  onAdClick?: (click: RecordedClick) => Promise<void> | void;
  /** Anuncios: (después del commit) entrante SIN ficha que pudo venir de un anuncio (respaldo con la conversación del proveedor). */
  onAdFallbackCandidate?: (job: FallbackJob) => Promise<void> | void;
  /** Doble verificación (después del commit): aviso 131060 del primer entrante, nacido "verificando". */
  onUnavailableNotice?: (m: { organizationId: string; messageId: string }) => Promise<void> | void;
};

export async function processWebhookEvent(
  provider: MessagingProvider,
  webhookEventId: string,
  hooks: IngestHooks = {},
): Promise<string> {
  const [found] = await db
    .select({
      row: webhookEvents,
      // Hora de RECEPCIÓN como instante (received_at es sin zona, escrito por
      // la base en su zona de sesión): respaldo de un mensaje que no trae hora.
      receivedMs: sql<string>`(extract(epoch from ${webhookEvents.receivedAt}::timestamptz) * 1000)::bigint`,
    })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, webhookEventId))
    .limit(1);
  if (!found) throw new PermanentIngestError(`webhook_event ${webhookEventId} no existe`);
  const row = found.row;
  if (row.processedAt) return "ya procesado";
  // Defensa adicional: la cuarentena (cuenta no permitida) no se procesa
  // aunque alguien la encole; se libera con scripts/replay-webhook-events.ts.
  if (row.quarantinedAt) return "en cuarentena: no se procesa";
  // La ruta del webhook ya pudo atribuir la organización al guardar (incluso
  // para eventos que terminarán "ignored"): no se pierde al procesar.
  const attributedOrgId = row.organizationId;

  await db
    .update(webhookEvents)
    .set({ attempts: sql`${webhookEvents.attempts} + 1` })
    .where(eq(webhookEvents.id, webhookEventId));

  try {
    const event = provider.normalize(row.payload, { receivedAt: new Date(Number(found.receivedMs)) });
    let outcome: string;
    let organizationId: string | null = attributedOrgId;
    let ignored = event.kind === "ignored";
    let orphanWamid: string | null = null;
    // Canal ARCHIVADO (docs/numero-prueba.md, paso 8): sus eventos quedan
    // registrados en webhook_events y NO se procesan (ni reintento ni dead-letter).
    const archived =
      event.kind !== "ignored" && event.providerAccountId ? await archivedChannelOf(provider.name, event.providerAccountId) : null;
    // El proveedor viene del adaptador que VERIFICÓ la firma, no del payload.
    try {
      if (archived) {
        outcome = `canal archivado: evento ${event.kind} registrado sin procesar`;
        organizationId = archived.organizationId;
        ignored = true;
      } else if (event.kind === "message") {
        const r = await ingestMessage(provider.name, event, hooks);
        outcome = r.outcome;
        organizationId = r.organizationId ?? attributedOrgId;
      } else if (event.kind === "status") {
        const r = await ingestStatus(provider.name, event);
        outcome = r.outcome;
        organizationId = r.organizationId ?? attributedOrgId;
      } else if (event.kind === "reaction" || event.kind === "message_change") {
        const r = await ingestMessageUpdate(provider.name, event);
        outcome = r.outcome;
        organizationId = r.organizationId ?? attributedOrgId;
      } else if (event.malformed) throw new DeadLetterIngestError(`formato no reconocido (${event.event}): ${event.reason}`);
      else outcome = `ignorado: ${event.reason}`;
    } catch (error) {
      // Eco sin atribuir que ya agotó su margen: dead-letter (visible y reprocesable).
      if (error instanceof UnattributedEchoError && (await receivedBefore(webhookEventId, ECHO_LINK_GRACE_MS))) {
        throw new DeadLetterIngestError(error.message);
      }
      // Huérfano viejo: se cierra como ignorado (queda la nota en last_error).
      if (!(error instanceof OrphanEventError) || !(await receivedBefore(webhookEventId, ORPHAN_GRACE_MS))) throw error;
      // No se pierde: queda marcado con el wamid que espera y el barrido del
      // worker lo REABRE en cuanto ese mensaje exista (llegue por webhook, por
      // la confirmación de un envío del CRM o por un replay).
      outcome = `huérfano: ${error.message} tras ${ORPHAN_GRACE_MS / 60_000} min; se reabre si llega el mensaje`;
      ignored = true;
      orphanWamid = error.awaiting;
      organizationId = error.organizationId ?? organizationId;
    }

    // Se atribuye el evento crudo a su organización (cuando se conoce): así al
    // borrar una organización se llevan sus payloads, y el barrido de retención
    // los cuenta como suyos.
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), lastError: ignored ? outcome : null, organizationId, orphanWamid })
      .where(eq(webhookEvents.id, webhookEventId));
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(webhookEvents)
      .set({
        lastError: message,
        // Un error permanente se da por procesado (no bloquea el barrido) pero queda el error.
        ...(error instanceof PermanentIngestError ? { processedAt: new Date() } : {}),
        ...(error instanceof DeadLetterIngestError ? { attempts: DEAD_LETTER_ATTEMPTS, deadLetteredAt: new Date() } : {}),
      })
      .where(eq(webhookEvents.id, webhookEventId));
    throw error;
  }
}

/**
 * ¿El evento se recibió hace más de `ms`? Se compara en SQL: received_at es un
 * timestamp sin zona escrito por la base (defaultNow), y leerlo en JS lo
 * desfasaría según la zona horaria de la sesión.
 */
async function receivedBefore(webhookEventId: string, ms: number): Promise<boolean> {
  const [row] = await db
    .select({ old: sql<boolean>`${webhookEvents.receivedAt} < localtimestamp - make_interval(secs => ${ms / 1000})` })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, webhookEventId));
  return row?.old ?? false;
}

/** Canal archivado de esa cuenta (si lo hay): sus eventos no se procesan. */
async function archivedChannelOf(provider: ProviderName, providerAccountId: string) {
  const [channel] = await db
    .select({ organizationId: channels.organizationId })
    .from(channels)
    .where(and(channelOf(provider, providerAccountId), isNotNull(channels.archivedAt)))
    .limit(1);
  return channel ?? null;
}

// El id de cuenta solo es único POR proveedor (índice (provider,
// provider_account_id)): buscar sin el proveedor podría, durante una migración
// Zernio → Meta, caer en el canal de otra organización.
function channelOf(provider: ProviderName, providerAccountId: string) {
  return and(eq(channels.provider, provider), eq(channels.providerAccountId, providerAccountId));
}

async function ingestMessage(
  provider: ProviderName,
  event: NormalizedMessageEvent,
  hooks: IngestHooks,
): Promise<{ outcome: string; organizationId: string | null }> {
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(channelOf(provider, event.providerAccountId), eq(channels.isActive, true)))
    .limit(1);
  if (!channel) {
    // Reintentable, NO permanente: si el canal aún no se configura (o se
    // desactivó por error), el mensaje se aplica en cuanto exista. Agotados
    // los intentos queda en webhook_events como dead-letter para replay.
    throw new RetryableIngestError(`no hay canal activo para la cuenta ${event.providerAccountId}`);
  }

  // Copia del historial del celular (con marca, o enviada antes de conectar el
  // número): sin agente, workflows, no leídos, ventana ni primera respuesta.
  if (isPhoneHistory(channel, event)) return ingestHistoryMessage(provider, channel, event, hooks);

  const { phone, bsuid } = eventIdentity(event);

  let mediaMessageId: string | undefined;
  // Mensaje NUEVO guardado en este intento (para los ganchos del Agente IA).
  // Objeto contenedor: se reinicia en cada intento de withTxRetry, así un
  // intento fallido no deja un aviso de una fila que no existe.
  const saved: { value: { direction: "in" | "out"; source: string; conversationId: string; messageId: string } | null } = {
    value: null,
  };
  // Anuncios (mismo patrón: se reinicia en cada intento de la transacción).
  const ad: { click: RecordedClick | null; fallback: FallbackJob | null } = { click: null, fallback: null };
  // Aviso 131060 del primer entrante que nació "verificando" (mismo patrón).
  const verifying: { messageId: string | null } = { messageId: null };
  const result = await withTxRetry(() => db.transaction(async (tx) => {
    saved.value = null;
    ad.click = null;
    ad.fallback = null;
    verifying.messageId = null;
    // Avisos que este mensaje real dejó como sombra (se descuentan de los no leídos).
    let shadowed = 0;
    const orgId = channel.organizationId;

    // Conversación ya existente del proveedor (canal + providerConversationId):
    // así un eco saliente sin teléfono se atribuye a su contacto sin inventarlo.
    let upserted = event.providerConversationId
      ? (
          await tx
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.channelId, channel.id),
                eq(conversations.providerConversationId, event.providerConversationId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;

    // Eco de un envío del CRM cuya conversación ya no se encuentra por id
    // (Zernio la cambió mientras el envío iba en vuelo): lo atribuye la fila
    // del propio mensaje, que sabe a qué conversación va. Sin esto, un eco sin
    // participantId acabaría en dead-letter y su fila en cola, sin enlazar.
    if (!upserted && event.direction === "out") {
      upserted = await conversationOfOwnMessage(tx, orgId, channel.id, event);
    }

    if (!upserted) {
      if (!phone && !bsuid) {
        // Sin teléfono, sin BSUID y sin conversación conocida no hay a quién
        // atribuirlo. NUNCA se descarta: dead-letter (queda en la BD, visible
        // y reprocesable con scripts/replay-webhook-events.ts). Un eco saliente
        // antes se reintenta: su fila puede estar por enlazar los ids (Z1).
        const reason =
          `${event.direction === "in" ? "entrante" : "eco saliente"} sin teléfono, BSUID ni conversación conocida ` +
          `(teléfono recibido: ${event.contactPhone ?? "ninguno"}, conversación ${event.providerConversationId})`;
        if (event.direction === "out") throw new UnattributedEchoError(reason);
        throw new DeadLetterIngestError(reason);
      }
      const contactId = await resolveContact(tx, orgId, { phone, bsuid, name: event.contactName }, undefined, {
        esPrueba: channel.isTest,
      });
      [upserted] = await tx
        .insert(conversations)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          contactId,
          channelId: channel.id,
          providerConversationId: event.providerConversationId,
          lastMessageAt: event.sentAt,
        })
        .onConflictDoUpdate({
          target: [conversations.channelId, conversations.contactId],
          set: {
            providerConversationId: sql`coalesce(${conversations.providerConversationId}, excluded.provider_conversation_id)`,
          },
        })
        .returning();
    } else if (phone || bsuid) {
      // Conversación ya conocida: su contacto aprende el teléfono/BSUID del
      // mensaje (los contactos previos no tienen BSUID).
      await resolveContact(tx, orgId, { phone, bsuid }, upserted.contactId);
    }

    // Se BLOQUEA la conversación ANTES de tocar mensajes, en el MISMO orden que
    // linkSentMessage (conversación → mensajes). Con el orden inverso, un eco
    // del webhook y la finalización del envío podían quedar en interbloqueo
    // (deadlock) y abortar un envío que el proveedor ya había aceptado.
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, upserted.id))
      .for("update");

    // Zernio puede abrir OTRA conversación (otro conversationId) para el mismo
    // cliente, y el envío usa provider_conversation_id: si se quedara el viejo,
    // el CRM mandaría a una conversación que Zernio ya pudo cerrar. Manda el
    // ENTRANTE más reciente; uno de la conversación vieja que llega tarde
    // (reintento, replay) no pisa al nuevo. Se decide ANTES de insertar este
    // mensaje y con la conversación bloqueada: la comparación es firme. Se
    // aplica abajo solo si el entrante de verdad se guardó (no en duplicados).
    // Si el id nuevo ya es de OTRA conversación (cliente duplicado como dos
    // contactos) solo puede ser por una carrera: el índice único rechaza la
    // transacción y el reintento lo atribuye por id (docs/go-live.md).
    const adoptProviderConversation =
      event.direction === "in" &&
      !!event.providerConversationId &&
      conversation.providerConversationId !== event.providerConversationId &&
      (await isNewestInbound(tx, orgId, conversation.id, event.sentAt));

    // Eco de un mensaje que el CRM mismo envió: ya existe la fila (en cola,
    // sin wamid). Se completa en lugar de duplicarla. El estado NO se fuerza a
    // "sent": si un estado (delivered/read/failed) llegó antes que este eco
    // (cuando la API confirmó con solo el id interno), nextStatus evita
    // retroceder y no borra el motivo de un fallo.
    let outcome: string | null = null;
    if (event.direction === "out") {
      const [pending] = await tx
        .select({ id: messages.id, status: messages.status })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, orgId),
            eq(messages.providerInternalId, event.providerInternalId),
            isNull(messages.providerMessageId),
          ),
        )
        .limit(1)
        .for("update");
      if (pending) {
        const merged = nextStatus(pending.status, "sent");
        await tx
          .update(messages)
          .set({
            providerMessageId: event.providerMessageId,
            status: merged,
            sentAt: event.sentAt,
            // Solo se limpia el error si el estado fusionado ya no es "failed".
            ...(merged === "failed" ? {} : { errorCode: null, errorMessage: null }),
          })
          .where(and(eq(messages.id, pending.id), eq(messages.organizationId, orgId)));
        outcome = "eco de envío del CRM enlazado";
      } else if (await adoptLateEcho(tx, orgId, conversation.id, event)) {
        // Eco tardío de un envío del CRM que quedó en duda (timeout): se une a su fila en
        // vez de guardarse como otro mensaje de "otra API" (lib/messaging/late-echo.ts).
        outcome = LATE_ECHO_OUTCOME;
      }
    }

    if (!outcome) {
      const first = event.attachments[0];
      // Doble verificación (caso SDA, lib/messaging/unavailable.ts): el aviso 131060 del
      // PRIMER entrante del chat nace "verificando" (ni burbuja ni Agente IA hasta
      // decidir); si su mensaje real ya llegó al lado (webhooks desordenados), nace
      // directamente como su sombra.
      const firstNotice =
        event.direction === "in" &&
        unavailableCode(event.metadata) === UNAVAILABLE_CODE &&
        !(await hasInboundApart(tx, orgId, upserted.id, event.sentAt));
      const realBeside = firstNotice ? await realInboundBeside(tx, orgId, upserted.id, event.sentAt) : null;
      const verify = firstNotice && !realBeside;
      const now = new Date();
      const inserted = await tx
        .insert(messages)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          conversationId: upserted.id,
          direction: event.direction,
          source: event.source,
          type: event.type,
          body: event.body,
          attachments: event.attachments,
          mediaUrl: first?.url ?? null,
          mediaMimeType: first?.mimeType ?? null,
          providerMessageId: event.providerMessageId,
          providerInternalId: event.providerInternalId,
          // Meta manda el anuncio UNA sola vez (primer mensaje tras el clic).
          adReferral: event.referral ?? null,
          metadata: realBeside
            ? resolvedMetadata(verifyingMetadata(event.metadata, now), "sombra", now, { mensajeReal: realBeside })
            : verify
              ? verifyingMetadata(event.metadata, now)
              : (event.metadata ?? null),
          status: event.direction === "in" ? "received" : "sent",
          sentAt: event.sentAt,
        })
        .onConflictDoNothing({ target: messages.providerMessageId })
        .returning({ id: messages.id });
      // Mismo wamid, pero el guardado era el aviso "no disponible" de Meta y
      // este trae el mensaje real: se completa la fila (lib/messaging/unavailable.ts).
      const completed =
        inserted.length === 0 && event.direction === "in" && !isUnavailableNotice(event.metadata)
          ? await completeUnavailableMessage(tx, orgId, event)
          : null;
      if (completed) {
        if (event.attachments.length > 0) mediaMessageId = completed.id;
        // Ahora sí: el agente y las palabras clave ven el mensaje real.
        saved.value = { direction: "in", source: event.source, conversationId: completed.conversationId, messageId: completed.id };
        outcome = COMPLETED_OUTCOME;
        // Con ficha del anuncio se registra el clic (único por mensaje: si el
        // respaldo ya lo atribuyó, no se duplica). Sin ficha, el aviso ya quedó
        // como candidato al respaldo cuando se guardó.
        if (event.referral) {
          await attributeAd(tx, {
            orgId,
            contactId: upserted.contactId,
            conversationId: completed.conversationId,
            messageId: completed.id,
            providerAccountId: event.providerAccountId,
            providerConversationId: event.providerConversationId,
            referral: event.referral,
            body: event.body,
            metadata: event.metadata,
            sentAt: event.sentAt,
            conversationChanged: false,
            ad,
          });
        }
      } else if (inserted.length === 0) {
        // Duplicado (reintento del proveedor, o eco de un envío ya enlazado):
        // no se inserta, pero la conversación SÍ se reconcilia abajo (último
        // mensaje, primera respuesta) por si quedó desactualizada.
        outcome = "mensaje duplicado (wamid ya guardado)";
      } else {
        if (event.attachments.length > 0) mediaMessageId = inserted[0].id;
        // El aviso "no disponible" no despierta al agente ni a las palabras
        // clave: no hay qué contestar hasta que llegue el mensaje real.
        if (!(event.direction === "in" && isUnavailableNotice(event.metadata))) {
          saved.value = { direction: event.direction, source: event.source, conversationId: upserted.id, messageId: inserted[0].id };
        }
        outcome = event.direction === "in" ? "entrante guardado" : `saliente (${event.source}) guardado`;
        if (verify) verifying.messageId = inserted[0].id;
        // Nació como sombra: el cliente escribió UN mensaje (el real ya contó).
        if (realBeside) shadowed = 1;
        // El mensaje real que llegó con OTRO wamid junto a un aviso en verificación:
        // el aviso era su sombra y se oculta.
        if (event.direction === "in" && !isUnavailableNotice(event.metadata)) {
          shadowed = await shadowNoticesOf(tx, orgId, upserted.id, { id: inserted[0].id, sentAt: event.sentAt });
        }
        if (event.direction === "in") {
          await attributeAd(tx, {
            orgId,
            contactId: upserted.contactId,
            conversationId: upserted.id,
            messageId: inserted[0].id,
            providerAccountId: event.providerAccountId,
            providerConversationId: event.providerConversationId,
            referral: event.referral,
            body: event.body,
            metadata: event.metadata,
            sentAt: event.sentAt,
            conversationChanged: adoptProviderConversation,
            ad,
          });
        }
      }
    }

    // La conversación ya está bloqueada arriba (FOR UPDATE): leer-y-sumar los
    // contadores aquí es seguro aunque varios mensajes lleguen a la vez.
    const updates: Partial<typeof conversations.$inferInsert> = {
      lastMessageAt:
        conversation.lastMessageAt && conversation.lastMessageAt > event.sentAt
          ? conversation.lastMessageAt
          : event.sentAt,
    };
    if (event.direction === "in" && outcome === "entrante guardado") {
      // Una sombra ya había contado como no leído: el cliente escribió UN mensaje.
      updates.unreadCount = Math.max(0, conversation.unreadCount + 1 - shadowed);
      updates.windowExpiresAt = windowExpiresAt(event.sentAt, conversation.windowExpiresAt);
      updates.status = "open";
      // El anuncio que ORIGINÓ la conversación: el primero, no se pisa.
      if (event.referral && !conversation.adReferral) updates.adReferral = event.referral;
      // Cada entrada por anuncio (también la de un cliente que vuelve por otro)
      // mueve la marca de la ventana gratis de 72 h.
      if (ad.click) {
        updates.adEntryAt =
          conversation.adEntryAt && conversation.adEntryAt > event.sentAt ? conversation.adEntryAt : event.sentAt;
      }
    }
    // Aviso completado: ya contó como no leído y abrió la ventana al guardarse;
    // solo se suma el anuncio si el mensaje real lo trae.
    if (outcome === COMPLETED_OUTCOME) {
      if (event.referral && !conversation.adReferral) updates.adReferral = event.referral;
      if (ad.click) {
        updates.adEntryAt =
          conversation.adEntryAt && conversation.adEntryAt > event.sentAt ? conversation.adEntryAt : event.sentAt;
      }
    }
    if (adoptProviderConversation && outcome === "entrante guardado") {
      updates.providerConversationId = event.providerConversationId;
      console.info(
        `[ingest] conversación ${conversation.id}: Zernio cambió de conversación ` +
          `${JSON.stringify(conversation.providerConversationId)} → ${JSON.stringify(event.providerConversationId)}; ` +
          `los envíos van a la nueva`,
      );
    }
    // Primera respuesta: se RECALCULA desde la base con cada mensaje nuevo,
    // no solo la primera vez. Los webhooks pueden llegar tarde y desordenados
    // (Meta reintenta, replay): un entrante más viejo que aparece después
    // adelanta la primera respuesta y alarga el tiempo. reconcileFirstResponse
    // toma el primer entrante y la primera respuesta humana posteriores, así
    // que converge al valor correcto sin importar el orden. Solo importa
    // cuando de verdad se insertó algo (no en duplicados).
    // Recalcular si aún no está fijada (también repara un duplicado que llega a
    // reconciliar una conversación vieja) o si de verdad se insertó un mensaje
    // (un entrante viejo que llega tarde adelanta la primera respuesta).
    if (
      conversation.firstResponseSeconds === null ||
      outcome === "entrante guardado" ||
      outcome.startsWith("saliente")
    ) {
      const seconds = await reconcileFirstResponse(tx, conversation.id);
      if (seconds !== null) updates.firstResponseSeconds = seconds;
    }
    // Palabra clave durable (B1): la marca "pendiente" entra en la MISMA transacción que el
    // mensaje; el gancho la cierra y el barrido retoma lo que un reinicio dejó a medias.
    if (saved.value?.direction === "in" && event.type === "text" && event.body) {
      await markKeywordPending(tx, saved.value.messageId);
    }
    await tx.update(conversations).set(updates).where(eq(conversations.id, conversation.id));
    return outcome;
  }));
  // Después del commit: la descarga ya puede leer la fila.
  if (mediaMessageId && hooks.onMediaMessage) await hooks.onMediaMessage(mediaMessageId);
  // Agente IA (después del commit): el entrante programa la respuesta; un eco
  // del vendedor desde el celular pausa al agente. Falla aislada: el mensaje ya
  // quedó guardado y un error del agente no debe volver a encolar la ingesta.
  const m = saved.value;
  try {
    if (m?.direction === "in" && hooks.onInboundMessage) {
      await hooks.onInboundMessage({
        organizationId: channel.organizationId,
        conversationId: m.conversationId,
        messageId: m.messageId,
        receivedAt: new Date(),
      });
    } else if (m?.direction === "out" && m.source === "business_app" && hooks.onHumanOutbound) {
      await hooks.onHumanOutbound({ organizationId: channel.organizationId, conversationId: m.conversationId });
    }
  } catch (error) {
    console.error(`[ingest] gancho del Agente IA falló para ${m?.conversationId}; el mensaje ya está guardado`, error);
  }
  // Doble verificación (después del commit, aislado): si encolar falla, el barrido la recoge.
  try {
    if (verifying.messageId && hooks.onUnavailableNotice) {
      await hooks.onUnavailableNotice({ organizationId: channel.organizationId, messageId: verifying.messageId });
    }
  } catch (error) {
    console.error(`[ingest] no se pudo programar la verificación de ${verifying.messageId}; la recoge el barrido`, error);
  }
  // Anuncios (después del commit, aislado): media, nombres de Meta y respaldo.
  // Si encolar falla, el barrido del worker lo recoge desde la base.
  try {
    if (ad.click && hooks.onAdClick) await hooks.onAdClick(ad.click);
    if (ad.fallback && hooks.onAdFallbackCandidate) await hooks.onAdFallbackCandidate(ad.fallback);
  } catch (error) {
    console.error(`[ingest] gancho de anuncios falló para ${m?.conversationId}; el mensaje ya está guardado`, error);
  }
  return { outcome: result, organizationId: channel.organizationId };
}

const COMPLETED_OUTCOME = "entrante completado (antes no disponible)";
export const LATE_ECHO_OUTCOME = "eco tardío enlazado a su envío sin confirmar";

/** Contenido real con el que se completa un aviso (del webhook, o de la copia de Zernio). */
export type UnavailableContent = Pick<
  NormalizedMessageEvent,
  "providerMessageId" | "type" | "body" | "attachments" | "referral" | "metadata"
>;

/**
 * Entrante guardado como aviso "no disponible" (mismo wamid) que ahora llega
 * con su contenido real: se completa la MISMA fila (texto, tipo, adjuntos,
 * anuncio) en lugar de descartar el mensaje real como duplicado. Devuelve la
 * fila completada, o null si el wamid guardado no era un aviso (duplicado real)
 * o si el aviso ya quedó como sombra de un mensaje real que llegó aparte (su
 * contenido ya está a la vista: completarlo lo duplicaría).
 */
export async function completeUnavailableMessage(
  tx: Tx,
  orgId: string,
  content: UnavailableContent,
): Promise<{ id: string; conversationId: string } | null> {
  if (!content.providerMessageId) return null;
  const [existing] = await tx
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      direction: messages.direction,
      metadata: messages.metadata,
      adReferral: messages.adReferral,
    })
    .from(messages)
    .where(and(eq(messages.organizationId, orgId), eq(messages.providerMessageId, content.providerMessageId)))
    .limit(1)
    .for("update");
  if (!existing || existing.direction !== "in" || !isUnavailableNotice(existing.metadata)) return null;
  if (noDisponibleEstado(existing.metadata) === "sombra") return null;
  const first = content.attachments[0];
  await tx
    .update(messages)
    .set({
      type: content.type,
      body: content.body,
      attachments: content.attachments,
      mediaUrl: first?.url ?? null,
      mediaMimeType: first?.mimeType ?? null,
      adReferral: existing.adReferral ?? content.referral ?? null,
      metadata: completedMetadata(existing.metadata, content.metadata, new Date()),
    })
    .where(and(eq(messages.id, existing.id), eq(messages.organizationId, orgId)));
  console.info(`[ingest] mensaje ${existing.id}: llegó primero como "no disponible" y se completó con el contenido real`);
  return { id: existing.id, conversationId: existing.conversationId };
}

/**
 * ¿El chat ya tenía entrantes (vivos o del historial) FUERA de la ventana del aviso? El
 * caso SDA es el primer mensaje; su propio mensaje real (al lado) no cuenta.
 */
async function hasInboundApart(tx: Tx, orgId: string, conversationId: string, sentAt: Date): Promise<boolean> {
  const [row] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "in"),
        or(
          lt(messages.sentAt, new Date(sentAt.getTime() - SHADOW_BEFORE_MS)),
          gt(messages.sentAt, new Date(sentAt.getTime() + SHADOW_AFTER_MS)),
          isNull(messages.sentAt),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Entrante REAL (no aviso) junto al aviso: el real llegó antes que su sombra. */
async function realInboundBeside(tx: Tx, orgId: string, conversationId: string, sentAt: Date): Promise<string | null> {
  const [row] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "in"),
        sql`not (coalesce(${messages.metadata}, '{}'::jsonb) ? 'unsupported')`,
        gte(messages.sentAt, new Date(sentAt.getTime() - SHADOW_BEFORE_MS)),
        lte(messages.sentAt, new Date(sentAt.getTime() + SHADOW_AFTER_MS)),
      ),
    )
    .orderBy(messages.sentAt)
    .limit(1);
  return row?.id ?? null;
}

/**
 * Avisos "verificando" del mismo chat cuya hora de WhatsApp cae junto a la del
 * mensaje real (el real llegó con OTRO wamid 0–5 s después; medido 29-sep-2026):
 * quedan como "sombra" (ocultos, con el id del real). Devuelve cuántos, para
 * descontar el no leído que ya habían sumado. La conversación ya está bloqueada.
 */
export async function shadowNoticesOf(
  tx: Tx,
  orgId: string,
  conversationId: string,
  real: { id: string; sentAt: Date },
  now = new Date(),
): Promise<number> {
  const notices = await tx
    .select({ id: messages.id, metadata: messages.metadata })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "in"),
        sql`${messages.metadata}->${NO_DISPONIBLE_KEY}->>'estado' = 'verificando'`,
        gte(messages.sentAt, new Date(real.sentAt.getTime() - SHADOW_AFTER_MS)),
        lte(messages.sentAt, new Date(real.sentAt.getTime() + SHADOW_BEFORE_MS)),
      ),
    )
    .for("update");
  for (const n of notices) {
    await tx
      .update(messages)
      .set({ metadata: resolvedMetadata(n.metadata, "sombra", now, { mensajeReal: real.id }) })
      .where(and(eq(messages.id, n.id), eq(messages.organizationId, orgId)));
    console.info(`[ingest] aviso ${n.id}: el mensaje real llegó aparte (${real.id}); el aviso se oculta`);
  }
  return notices.length;
}

/**
 * Anuncio de un entrante recién guardado (dentro de la transacción):
 * - con ficha → registra el clic (en un savepoint: si falla, el mensaje entra
 *   igual y el barrido lo reintenta desde messages.ad_referral);
 * - sin ficha, pero pudo venir de un anuncio (primer entrante de la
 *   conversación, Zernio cambió de conversación, o señales de anuncio en el
 *   texto/metadata) → candidato al respaldo con la conversación del proveedor.
 */
async function attributeAd(
  tx: Tx,
  p: {
    orgId: string;
    contactId: string;
    conversationId: string;
    messageId: string;
    providerAccountId: string;
    providerConversationId: string;
    referral: Record<string, unknown> | undefined;
    body: string | null;
    metadata: Record<string, unknown> | undefined;
    sentAt: Date;
    conversationChanged: boolean;
    ad: { click: RecordedClick | null; fallback: FallbackJob | null };
  },
): Promise<void> {
  if (p.referral) {
    const click = await recordAdClickSafely(tx, {
      organizationId: p.orgId,
      contactId: p.contactId,
      conversationId: p.conversationId,
      messageId: p.messageId,
      origin: "webhook",
      raw: p.referral,
      clickedAt: p.sentAt,
    });
    p.ad.click = click === "error" ? null : click;
    return;
  }
  if (!p.providerConversationId) return;
  const looksLikeAd = looksLikeAdMessage(p.body, p.metadata);
  let candidate = looksLikeAd || p.conversationChanged;
  if (!candidate) {
    const [earlier] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, p.orgId),
          eq(messages.conversationId, p.conversationId),
          eq(messages.direction, "in"),
          sql`${messages.id} <> ${p.messageId}`,
        ),
      )
      .limit(1);
    candidate = !earlier;
  }
  if (candidate) {
    p.ad.fallback = {
      organizationId: p.orgId,
      messageId: p.messageId,
      providerAccountId: p.providerAccountId,
      providerConversationId: p.providerConversationId,
      looksLikeAd,
    };
    // Registro durable ("pendiente") en la MISMA transacción del mensaje: si
    // encolar falla después del commit, el barrido lo retoma desde aquí.
    await tx
      .update(messages)
      .set({
        metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || jsonb_build_object('anuncioRespaldo', ${JSON.stringify(pendingFallbackNote(p.ad.fallback))}::jsonb)`,
      })
      .where(and(eq(messages.id, p.messageId), eq(messages.organizationId, p.orgId)));
  }
}

/**
 * Tras un saliente confirmado del CRM, DENTRO de la transacción que lo enlaza
 * (así un corte a la mitad no deja el mensaje enviado con la conversación
 * vieja): último mensaje, primera respuesta y no leídos hasta el corte que el
 * vendedor tenía a la vista. Bloquea la conversación; quien llama la bloquea
 * ANTES que los mensajes (mismo orden que la ingesta).
 */
export async function applyOutboundToConversation(
  tx: Tx,
  conversationId: string,
  sentAt: Date,
  readCutoffMessageId: string | null,
): Promise<void> {
  const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, conversationId)).for("update");
  if (!conversation) return;
  const updates: Partial<typeof conversations.$inferInsert> = {
    lastMessageAt:
      conversation.lastMessageAt && conversation.lastMessageAt > sentAt ? conversation.lastMessageAt : sentAt,
    unreadCount: await unreadAfterCutoff(tx, conversation, readCutoffMessageId),
  };
  if (conversation.firstResponseSeconds === null) {
    const seconds = await reconcileFirstResponse(tx, conversationId);
    if (seconds !== null) updates.firstResponseSeconds = seconds;
  }
  await tx.update(conversations).set(updates).where(eq(conversations.id, conversationId));
}

/**
 * ¿Un entrante con esta hora sería el más reciente de la conversación? Estricto:
 * con la misma hora (WhatsApp tiene resolución de segundos) no se sabe cuál es
 * el nuevo y se queda el actual. Un duplicado (mismo wamid) tampoco cuenta.
 */
async function isNewestInbound(tx: Tx, orgId: string, conversationId: string, sentAt: Date): Promise<boolean> {
  const [sameOrNewer] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "in"),
        gte(messages.sentAt, sentAt),
      ),
    )
    .limit(1);
  return !sameOrNewer;
}

/**
 * Conversación (del canal) del mensaje propio al que corresponde un eco: la
 * fila en cola (id interno) o la ya enlazada (wamid).
 */
async function conversationOfOwnMessage(
  tx: Tx,
  orgId: string,
  channelId: string,
  event: NormalizedMessageEvent,
): Promise<typeof conversations.$inferSelect | undefined> {
  const [row] = await tx
    .select({ conversation: conversations })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(conversations.channelId, channelId),
        or(
          eq(messages.providerInternalId, event.providerInternalId),
          eq(messages.providerMessageId, event.providerMessageId),
        ),
      ),
    )
    .limit(1);
  return row?.conversation;
}

/** Último entrante de la conversación: el corte de lectura de lo que hay a la vista. */
export async function latestInboundMessageId(conversationId: string, tx: Tx | typeof db = db): Promise<string | null> {
  const [row] = await tx
    .select({ id: messages.id })
    .from(messages)
    // Lo importado del historial nunca es el corte de lectura (se guarda "ahora" pero es viejo).
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in"), isNull(messages.importedAt)))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * No leídos tras marcar como leído todo lo entrante hasta `cutoffMessageId`
 * (inclusive): los entrantes guardados DESPUÉS del corte siguen sin leer. Se
 * compara en SQL (la hora del corte con microsegundos, sin pasar por JS).
 * Nunca sube el contador: un corte viejo que llega tarde (p. ej. un envío
 * lento) no revive como no leído lo que otra lectura ya marcó. Idempotente.
 */
export async function unreadAfterCutoff(
  tx: Tx,
  conversation: { id: string; unreadCount: number },
  cutoffMessageId: string | null,
): Promise<number> {
  if (!cutoffMessageId) return conversation.unreadCount; // no había nada a la vista
  const [{ value }] = await tx
    .select({ value: count() })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.direction, "in"),
        // El historial importado no cuenta como no leído.
        isNull(messages.importedAt),
        // Un aviso oculto (sombra o en verificación) tampoco: el real ya cuenta.
        not(hiddenNoticeSql(messages.metadata)),
        sql`${messages.createdAt} > (select created_at from messages where id = ${cutoffMessageId})`,
      ),
    );
  return Math.min(conversation.unreadCount, value);
}

async function reconcileFirstResponse(tx: Tx, conversationId: string): Promise<number | null> {
  // Columnas tipadas (no min() crudo): el driver devuelve un timestamp sin
  // zona como texto y new Date() lo leería en hora local, no en UTC.
  const [firstIn] = await tx
    .select({ at: messages.sentAt })
    .from(messages)
    // Lo importado del historial del celular no cuenta (ni entrante ni respuesta).
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in"), isNull(messages.importedAt)))
    .orderBy(asc(messages.sentAt))
    .limit(1);
  if (!firstIn?.at) return null;
  const [firstReply] = await tx
    .select({ at: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        isNull(messages.importedAt),
        // Un aviso interno (Fase D) nunca salió al cliente: no es respuesta.
        sql`${messages.type} <> 'system_note'`,
        // Humano verificado: desde la app del celular (coexistencia) o desde el
        // CRM con el usuario que lo envió. Una difusión, automatización o el bot
        // (sin sent_by_user_id) no cuenta como primera respuesta.
        or(
          eq(messages.source, "business_app"),
          and(eq(messages.source, "crm"), isNotNull(messages.sentByUserId)),
        ),
        // Solo lo que de verdad salió: un envío en cola, de resultado
        // desconocido o fallido no es una respuesta al cliente.
        inArray(messages.status, ["sent", "delivered", "read"]),
        gte(messages.sentAt, firstIn.at),
      ),
    )
    .orderBy(asc(messages.sentAt))
    .limit(1);
  return firstReply?.at ? firstResponseSeconds(firstIn.at, firstReply.at) : null;
}

type Identity = { phone: string | null; bsuid: string | null; name?: string };

/**
 * Teléfono y BSUID del mensaje. El teléfono puede faltar (eco sin
 * participantId, o cliente con nombre de usuario de WhatsApp: solo BSUID). NO
 * se inventa: se atribuye por la conversación existente, o por el BSUID.
 * normalizePhone ya deja a México como +52 + 10 dígitos (quita el 1 heredado).
 */
export function eventIdentity(event: Pick<NormalizedMessageEvent, "contactPhone" | "contactBsuid">): {
  phone: string | null;
  bsuid: string | null;
} {
  let phone: string | null = null;
  if (event.contactPhone) {
    try {
      phone = normalizePhone(event.contactPhone);
    } catch {
      phone = null;
    }
  }
  return { phone, bsuid: event.contactBsuid ?? null };
}

/**
 * Cómo nace un contacto que aún no existe (source/etapa por omisión: WhatsApp, Inbox).
 * `esPrueba`: lo creó un canal de prueba. Solo se marca al NACER: un contacto que ya
 * existía (p. ej. un cliente real importado de GHL que también escribió al número de
 * prueba) nunca se marca "Prueba".
 */
export type NewContactOptions = { source?: string; esPrueba?: boolean };

/**
 * Contacto del mensaje. Prioridad ESTABLE: BSUID (único por organización; Zernio
 * lo recomienda como ancla principal de identidad) → teléfono → nuevo. Con
 * `knownContactId` (la conversación del proveedor ya existía) no busca a quién
 * atribuir: solo le ENSEÑA al contacto el BSUID/teléfono del mensaje, si nadie
 * más los tiene. Un BSUID NUNCA se mueve de contacto: si dos contactos parecen
 * el mismo cliente (uno por BSUID, otro por teléfono) se registra el conflicto
 * para fusionarlos a mano, sin que la atribución cambie de un mensaje a otro.
 */
export async function resolveContact(
  tx: Tx,
  orgId: string,
  identity: Identity,
  knownContactId?: string,
  newContact: NewContactOptions = {},
): Promise<string> {
  const { phone, bsuid } = identity;
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${contactsImportLockKey(orgId)}, 0))`);
  // Serializa por (organización, identidad): dos mensajes simultáneos de un
  // número nuevo no pueden crear dos contactos. Un candado por CADA identidad
  // del mensaje, en orden fijo (sin interbloqueos).
  const keys = [phone && `contact:${orgId}:phone:${phone}`, bsuid && `contact:${orgId}:bsuid:${bsuid}`]
    .filter((k): k is string => Boolean(k))
    .sort();
  for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);

  const [byBsuid] = bsuid
    ? await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.organizationId, orgId), eq(contacts.waBsuid, bsuid)))
        .limit(1)
    : [];
  // Teléfono (el más viejo gana si hay duplicados de GHL).
  const [byPhone] = phone
    ? await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.organizationId, orgId), inArray(contacts.phoneE164, phoneLookupVariants(phone))))
        .orderBy(asc(contacts.createdAt), asc(contacts.id))
        .limit(1)
    : [];

  const targetId = knownContactId ?? byBsuid?.id ?? byPhone?.id;
  if (!targetId) {
    const id = crypto.randomUUID();
    const name = identity.name?.trim();
    await tx.insert(contacts).values({
      id,
      organizationId: orgId,
      // Nombre de perfil de WhatsApp; si no viene, el teléfono; si tampoco, algo legible.
      firstName: name || phone || "Cliente de WhatsApp",
      ...phoneColumns(phone),
      country: countryFromPhone(phone),
      waBsuid: bsuid,
      source: newContact.source ?? "whatsapp",
      sourceChannel: "whatsapp",
      esPrueba: newContact.esPrueba ?? false,
      // Arriba de su columna en el kanban (Contactos ordena por stage_changed_at). La
      // etapa es la que tenga el papel "entrada" en esta organización (funnel_stages),
      // se llame como se llame hoy; sin ella (dato roto) cae en la clave 'inbox'.
      stage: sql`coalesce((select fs.key from funnel_stages fs where fs.organization_id = ${orgId} and fs.role = 'entrada'), 'inbox')`,
      stageChangedAt: new Date(),
    });
    return id;
  }

  const conflicts = [byBsuid, byPhone].filter((c) => c && c.id !== targetId).map((c) => c!.id);
  if (conflicts.length > 0) {
    console.warn(
      `[ingest] identidad: el mensaje se atribuye al contacto ${targetId}, pero su ` +
        `${byBsuid && byBsuid.id !== targetId ? "BSUID" : "teléfono"} también está en ${[...new Set(conflicts)].join(", ")}; revisar para fusionar`,
    );
  }

  const [target] = await tx
    .select({ waBsuid: contacts.waBsuid, phoneE164: contacts.phoneE164, country: contacts.country })
    .from(contacts)
    .where(and(eq(contacts.id, targetId), eq(contacts.organizationId, orgId)));
  if (!target) return targetId;
  // Aprender el BSUID solo si el contacto no tiene y NADIE más lo tiene.
  if (bsuid && !target.waBsuid && !byBsuid) {
    await tx.update(contacts).set({ waBsuid: bsuid }).where(eq(contacts.id, targetId));
  }
  // Aprender el teléfono solo si el contacto no tiene y NADIE más lo tiene.
  if (phone && !target.phoneE164 && !byPhone) {
    await tx
      .update(contacts)
      .set({ ...phoneColumns(phone), ...(target.country ? {} : { country: countryFromPhone(phone) }) })
      .where(eq(contacts.id, targetId));
  }
  return targetId;
}

async function ingestStatus(
  provider: ProviderName,
  event: NormalizedStatusEvent,
): Promise<{ outcome: string; organizationId: string | null }> {
  // La organización sale del canal (proveedor + cuenta), nunca de un id de
  // mensaje suelto: un estado jamás toca mensajes de otra organización.
  let orgId: string | undefined;
  if (event.providerAccountId) {
    const [channel] = await db
      .select({ organizationId: channels.organizationId })
      .from(channels)
      .where(channelOf(provider, event.providerAccountId))
      .limit(1);
    if (!channel) throw new RetryableIngestError(`no hay canal para la cuenta ${event.providerAccountId}`);
    orgId = channel.organizationId;
  }

  let match;
  if (event.providerMessageId) {
    // El wamid es único en todo WhatsApp (índice único global).
    match = eq(messages.providerMessageId, event.providerMessageId);
  } else if (event.providerInternalId && orgId) {
    match = and(eq(messages.organizationId, orgId), eq(messages.providerInternalId, event.providerInternalId));
  } else {
    throw new PermanentIngestError("estado sin wamid ni cuenta del proveedor: no se puede atribuir con seguridad");
  }

  let revokeReplyOf: string | undefined;
  let confirmed: { conversationId: string; sentAt: Date } | undefined;
  let newlyFailed: FailedOutbound | undefined;
  let resolvedOrgId: string | null = orgId ?? null;
  const outcome = await withTxRetry(() => db.transaction(async (tx) => {
    // FOR UPDATE: dos estados del mismo mensaje procesándose a la vez (p. ej.
    // read y un delivered tardío) se serializan; el segundo ve el valor ya
    // escrito por el primero y nextStatus nunca retrocede.
    const [message] = await tx.select().from(messages).where(match).limit(1).for("update");
    if (!message) {
      // El estado llegó antes que el mensaje (o su eco): reintentar más tarde.
      // Pasado ORPHAN_GRACE_MS se da por ignorado (processWebhookEvent).
      throw new OrphanEventError("mensaje del estado aún no existe", orphanKey(event), orgId ?? null);
    }
    if (orgId && message.organizationId !== orgId) {
      throw new PermanentIngestError("el estado apunta a un mensaje de otra organización; se rechaza");
    }
    resolvedOrgId = message.organizationId;
    const status = nextStatus(message.status, event.status);
    // Un saliente que WhatsApp terminó rechazando no llegó al cliente: si fijó
    // la primera respuesta, se recalcula DESPUÉS del commit (en su propia
    // transacción, para no bloquear mensaje y conversación en orden inverso
    // al de la ingesta).
    if (status === "failed" && message.status !== "failed" && message.direction === "out") {
      revokeReplyOf = message.conversationId;
      newlyFailed = {
        organizationId: message.organizationId,
        conversationId: message.conversationId,
        messageId: message.id,
        type: message.type,
        errorCode: event.errorCode ?? message.errorCode,
        errorMessage: event.errorMessage ?? message.errorMessage,
      };
    }
    // Prueba de que salió (Bloque B): un saliente "fallido" que WhatsApp marca
    // entregado/leído, o uno "en cola" que Zernio aceptó sin que el CRM alcanzara
    // a guardarlo (SEND_ACCEPTED), queda confirmado y SIN error; la conversación y
    // la primera respuesta se recalculan después del commit.
    const nowConfirmed =
      message.direction === "out" && status !== "failed" && status !== message.status && (message.status === "failed" || message.status === "queued");
    if (nowConfirmed) confirmed = { conversationId: message.conversationId, sentAt: message.sentAt ?? message.createdAt };
    await tx
      .update(messages)
      .set({
        status,
        ...(status === "failed"
          ? { errorCode: event.errorCode ?? message.errorCode, errorMessage: event.errorMessage ?? message.errorMessage }
          : nowConfirmed
            ? { errorCode: null, errorMessage: null }
            : {}),
        ...(event.providerMessageId && !message.providerMessageId ? { providerMessageId: event.providerMessageId } : {}),
      })
      .where(and(eq(messages.id, message.id), eq(messages.organizationId, message.organizationId)));
    return `estado ${message.status} → ${status}`;
  }));
  if (revokeReplyOf) await recomputeFirstResponse(revokeReplyOf);
  if (confirmed) await refreshAfterConfirmedOutbound(confirmed.conversationId, confirmed.sentAt);
  // Un archivo de un workflow que WhatsApp aceptó y luego rechazó: tarjeta en el chat.
  if (newlyFailed) await noticeWorkflowSendFailed(newlyFailed);
  return { outcome, organizationId: resolvedOrgId };
}

/**
 * Un saliente que quedó confirmado por un estado (antes fallido, o aceptado sin
 * guardar): último mensaje de la conversación y primera respuesta desde la base
 * (converge sin importar el orden de los avisos). Su propia transacción, con la
 * conversación bloqueada primero (mismo orden que la ingesta).
 */
async function refreshAfterConfirmedOutbound(conversationId: string, sentAt: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (!conversation) return;
    await tx
      .update(conversations)
      .set({
        lastMessageAt: conversation.lastMessageAt && conversation.lastMessageAt > sentAt ? conversation.lastMessageAt : sentAt,
        firstResponseSeconds: await reconcileFirstResponse(tx, conversationId),
      })
      .where(eq(conversations.id, conversationId));
  });
}

async function recomputeFirstResponse(conversationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ firstResponseSeconds: conversations.firstResponseSeconds })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (!conversation || conversation.firstResponseSeconds === null) return;
    await tx
      .update(conversations)
      .set({ firstResponseSeconds: await reconcileFirstResponse(tx, conversationId) })
      .where(eq(conversations.id, conversationId));
  });
}

/**
 * Reacción, edición o borrado de un mensaje ya guardado. Se cruza por wamid
 * (único en WhatsApp) y se acota a la organización del canal. Si el mensaje aún
 * no existe se reintenta; pasado ORPHAN_GRACE_MS se da por ignorado.
 */
async function ingestMessageUpdate(
  provider: ProviderName,
  event: NormalizedReactionEvent | NormalizedMessageChangeEvent,
): Promise<{ outcome: string; organizationId: string | null }> {
  const [channel] = await db
    .select({ organizationId: channels.organizationId })
    .from(channels)
    .where(channelOf(provider, event.providerAccountId))
    .limit(1);
  if (!channel) throw new RetryableIngestError(`no hay canal para la cuenta ${event.providerAccountId}`);
  const orgId = channel.organizationId;

  const outcome = await withTxRetry(() => db.transaction(async (tx) => {
    const [message] = await tx
      .select({
        id: messages.id,
        reactions: messages.reactions,
        metadata: messages.metadata,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
      })
      .from(messages)
      .where(and(eq(messages.organizationId, orgId), eq(messages.providerMessageId, event.providerMessageId)))
      .limit(1)
      .for("update");
    if (!message) throw new OrphanEventError(`mensaje ${event.providerMessageId} no existe en el CRM`, event.providerMessageId, orgId);

    // Los webhooks (y los replays) llegan desordenados: solo se aplica un
    // evento MÁS RECIENTE que lo vigente; uno viejo no revive ni retrocede nada.
    if (event.kind === "reaction") {
      const current = message.reactions[event.side];
      if (current && new Date(current.at).getTime() >= event.at.getTime()) {
        return `reacción ${event.action} (${event.side}) más vieja que la vigente: sin cambios`;
      }
      const reactions = {
        ...message.reactions,
        [event.side]: { emoji: event.action === "removed" || !event.emoji ? null : event.emoji, at: event.at.toISOString() },
      };
      await tx.update(messages).set({ reactions }).where(eq(messages.id, message.id));
      return `reacción ${event.action} (${event.side})`;
    }
    if (event.change === "edited") {
      if (message.editedAt && message.editedAt.getTime() >= event.at.getTime()) {
        return "edición más vieja que la vigente: sin cambios";
      }
      await tx
        .update(messages)
        .set({
          body: event.body ?? null,
          editedAt: event.at,
          metadata: { ...(message.metadata ?? {}), editHistory: event.editHistory ?? [] },
        })
        .where(eq(messages.id, message.id));
      return "mensaje editado";
    }
    // Borrado: se marca, NO se borra el contenido (queda para consulta).
    if (message.deletedAt) return "mensaje ya marcado como eliminado";
    await tx.update(messages).set({ deletedAt: event.at }).where(eq(messages.id, message.id));
    return "mensaje eliminado por su autor";
  }));
  return { outcome, organizationId: orgId };
}

/**
 * Barrido del worker (revisión completa P1, 28-sep-2026): un estado SIN cuenta que llegó antes que
 * su mensaje quedó en cuarentena con el wamid que espera (orphan_wamid). En cuanto ese mensaje existe
 * en esta base —lo que prueba que es de este entorno—, se libera: toma la organización del mensaje y
 * vuelve a pendientes (el barrido lo procesa). Las filas de cuentas ajenas nunca traen orphan_wamid y
 * siguen en cuarentena. Devuelve cuántos.
 */
export async function releaseQuarantinedStatuses(): Promise<number> {
  const released = await db.execute<{ id: string }>(sql`
    update ${webhookEvents} w
       set quarantined_at = null, processed_at = null, attempts = 0, last_error = null,
           orphan_wamid = null, organization_id = m.organization_id
      from ${messages} m
     where w.quarantined_at is not null
       and w.processed_at is null
       and w.orphan_wamid is not null
       and m.provider_message_id = w.orphan_wamid
    returning w.id`);
  return released.length;
}

/**
 * Barrido del worker: reabre los huérfanos cerrados cuyo mensaje YA existe
 * (llegó tarde: caída del worker, cola larga, confirmación de envío lenta).
 * Vuelven a pendientes y el mismo barrido los procesa. Devuelve cuántos.
 */
export async function reopenResolvedOrphans(): Promise<number> {
  const reopened = await db.execute<{ id: string }>(sql`
    update ${webhookEvents} w
       set processed_at = null, attempts = 0, last_error = null, orphan_wamid = null
     where w.orphan_wamid is not null
       and exists (
         select 1 from ${messages} m
          where m.organization_id = w.organization_id
            and (m.provider_message_id = w.orphan_wamid
                 or (w.orphan_wamid like 'internal:%' and m.provider_internal_id = substr(w.orphan_wamid, 10)))
       )
    returning w.id`);
  return reopened.length;
}
