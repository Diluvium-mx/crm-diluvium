// Aplica un evento normalizado a la base (lo usa el worker). Toda consulta
// filtra por organización: la organización sale del CANAL (el número de
// WhatsApp conectado), nunca del payload.
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withTxRetry } from "@/lib/db/retry";
import { channels, contacts, conversations, messages, webhookEvents } from "@/lib/db/schema";
import { canonicalPhone, normalizePhone, phoneLookupVariants } from "@/lib/phone";
import type { MessagingProvider, NormalizedMessageEvent, NormalizedStatusEvent, ProviderName } from "./provider";
import { firstResponseSeconds, nextStatus, windowExpiresAt } from "./rules";

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

/** Intentos a partir de los cuales un evento pendiente se considera dead-letter. */
export const DEAD_LETTER_ATTEMPTS = 20;

export type IngestHooks = {
  /** Se llama (después del commit) con cada mensaje nuevo que trae adjuntos. */
  onMediaMessage?: (messageId: string) => Promise<void> | void;
};

export async function processWebhookEvent(
  provider: MessagingProvider,
  webhookEventId: string,
  hooks: IngestHooks = {},
): Promise<string> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId)).limit(1);
  if (!row) throw new PermanentIngestError(`webhook_event ${webhookEventId} no existe`);
  if (row.processedAt) return "ya procesado";
  // La ruta del webhook ya pudo atribuir la organización al guardar (incluso
  // para eventos que terminarán "ignored"): no se pierde al procesar.
  const attributedOrgId = row.organizationId;

  await db
    .update(webhookEvents)
    .set({ attempts: sql`${webhookEvents.attempts} + 1` })
    .where(eq(webhookEvents.id, webhookEventId));

  try {
    const event = provider.normalize(row.payload);
    let outcome: string;
    let organizationId: string | null = attributedOrgId;
    // El proveedor viene del adaptador que VERIFICÓ la firma, no del payload.
    if (event.kind === "message") {
      const r = await ingestMessage(provider.name, event, hooks);
      outcome = r.outcome;
      organizationId = r.organizationId ?? attributedOrgId;
    } else if (event.kind === "status") {
      const r = await ingestStatus(provider.name, event);
      outcome = r.outcome;
      organizationId = r.organizationId ?? attributedOrgId;
    }
    else if (event.malformed) throw new DeadLetterIngestError(`formato no reconocido (${event.event}): ${event.reason}`);
    else outcome = `ignorado: ${event.reason}`;

    // Se atribuye el evento crudo a su organización (cuando se conoce): así al
    // borrar una organización se llevan sus payloads, y el barrido de retención
    // los cuenta como suyos.
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), lastError: event.kind === "ignored" ? outcome : null, organizationId })
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
        ...(error instanceof DeadLetterIngestError ? { attempts: DEAD_LETTER_ATTEMPTS } : {}),
      })
      .where(eq(webhookEvents.id, webhookEventId));
    throw error;
  }
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

  // El teléfono puede faltar en un eco saliente (p. ej. sin participantId): en
  // ese caso NO se inventa, se atribuye por la conversación existente.
  let phone: string | null;
  try {
    phone = canonicalPhone(normalizePhone(event.contactPhone));
  } catch {
    phone = null;
  }

  let mediaMessageId: string | undefined;
  const result = await withTxRetry(() => db.transaction(async (tx) => {
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

    if (!upserted) {
      if (!phone) {
        // Sin teléfono ni conversación conocida no hay a quién atribuirlo. Un
        // entrante así es malformado; un eco saliente puede resolverse cuando
        // exista la conversación → dead-letter para replay, no se pierde.
        if (event.direction === "in") {
          throw new PermanentIngestError(`teléfono de contacto inválido: ${event.contactPhone}`);
        }
        throw new DeadLetterIngestError(
          `eco saliente sin teléfono ni conversación conocida (${event.providerConversationId})`,
        );
      }
      const contactId = await findOrCreateContact(tx, orgId, phone, event.contactName);
      [upserted] = await tx
        .insert(conversations)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          contactId,
          channelId: channel.id,
          providerConversationId: event.providerConversationId,
        })
        .onConflictDoUpdate({
          target: [conversations.channelId, conversations.contactId],
          set: {
            providerConversationId: sql`coalesce(${conversations.providerConversationId}, excluded.provider_conversation_id)`,
          },
        })
        .returning();
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
      }
    }

    if (!outcome) {
      const first = event.attachments[0];
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
          status: event.direction === "in" ? "received" : "sent",
          sentAt: event.sentAt,
        })
        .onConflictDoNothing({ target: messages.providerMessageId })
        .returning({ id: messages.id });
      if (inserted.length === 0) {
        // Duplicado (reintento del proveedor, o eco de un envío ya enlazado):
        // no se inserta, pero la conversación SÍ se reconcilia abajo (último
        // mensaje, primera respuesta) por si quedó desactualizada.
        outcome = "mensaje duplicado (wamid ya guardado)";
      } else {
        if (event.attachments.length > 0) mediaMessageId = inserted[0].id;
        outcome = event.direction === "in" ? "entrante guardado" : `saliente (${event.source}) guardado`;
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
      updates.unreadCount = conversation.unreadCount + 1;
      updates.windowExpiresAt = windowExpiresAt(event.sentAt, conversation.windowExpiresAt);
      updates.status = "open";
      // El anuncio que ORIGINÓ la conversación: el primero, no se pisa.
      if (event.referral && !conversation.adReferral) updates.adReferral = event.referral;
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
    await tx.update(conversations).set(updates).where(eq(conversations.id, conversation.id));
    return outcome;
  }));
  // Después del commit: la descarga ya puede leer la fila.
  if (mediaMessageId && hooks.onMediaMessage) await hooks.onMediaMessage(mediaMessageId);
  return { outcome: result, organizationId: channel.organizationId };
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

/** Último entrante de la conversación: el corte de lectura de lo que hay a la vista. */
export async function latestInboundMessageId(conversationId: string, tx: Tx | typeof db = db): Promise<string | null> {
  const [row] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in")))
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
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in")))
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

async function findOrCreateContact(tx: Tx, orgId: string, phone: string, name?: string): Promise<string> {
  // Serializa por (organización, teléfono canónico) dentro de la transacción:
  // dos mensajes simultáneos de un número nuevo no pueden crear dos contactos
  // (y partir el historial en dos conversaciones). Se usa un candado y no un
  // índice único porque los contactos importados pueden traer duplicados.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`contact:${orgId}:${phone}`}, 0))`);
  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.organizationId, orgId), inArray(contacts.phoneE164, phoneLookupVariants(phone))))
    .orderBy(asc(contacts.createdAt))
    .limit(1);
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await tx.insert(contacts).values({
    id,
    organizationId: orgId,
    firstName: name?.trim() || phone,
    phoneE164: phone,
    source: "whatsapp",
    sourceChannel: "whatsapp",
  });
  return id;
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
  let resolvedOrgId: string | null = orgId ?? null;
  const outcome = await withTxRetry(() => db.transaction(async (tx) => {
    // FOR UPDATE: dos estados del mismo mensaje procesándose a la vez (p. ej.
    // read y un delivered tardío) se serializan; el segundo ve el valor ya
    // escrito por el primero y nextStatus nunca retrocede.
    const [message] = await tx.select().from(messages).where(match).limit(1).for("update");
    if (!message) {
      // El estado llegó antes que el mensaje (o su eco): reintentar más tarde.
      throw new RetryableIngestError("mensaje del estado aún no existe");
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
    }
    await tx
      .update(messages)
      .set({
        status,
        ...(status === "failed"
          ? { errorCode: event.errorCode ?? message.errorCode, errorMessage: event.errorMessage ?? message.errorMessage }
          : {}),
        ...(event.providerMessageId && !message.providerMessageId ? { providerMessageId: event.providerMessageId } : {}),
      })
      .where(and(eq(messages.id, message.id), eq(messages.organizationId, message.organizationId)));
    return `estado ${message.status} → ${status}`;
  }));
  if (revokeReplyOf) await recomputeFirstResponse(revokeReplyOf);
  return { outcome, organizationId: resolvedOrgId };
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
