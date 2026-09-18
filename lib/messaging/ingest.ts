// Aplica un evento normalizado a la base (lo usa el worker). Toda consulta
// filtra por organización: la organización sale del CANAL (el número de
// WhatsApp conectado), nunca del payload.
import { and, asc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages, webhookEvents } from "@/lib/db/schema";
import { canonicalPhone, normalizePhone, phoneLookupVariants } from "@/lib/phone";
import type { MessagingProvider, NormalizedMessageEvent, NormalizedStatusEvent, ProviderName } from "./provider";
import { firstResponseSeconds, nextStatus, windowExpiresAt } from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Error que no se arregla reintentando (el evento queda marcado, no se reintenta). */
export class PermanentIngestError extends Error {}
/** Error transitorio: BullMQ reintenta con backoff (p. ej. estado que llegó antes que su mensaje). */
export class RetryableIngestError extends Error {}

export async function processWebhookEvent(provider: MessagingProvider, webhookEventId: string): Promise<string> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId)).limit(1);
  if (!row) throw new PermanentIngestError(`webhook_event ${webhookEventId} no existe`);
  if (row.processedAt) return "ya procesado";

  await db
    .update(webhookEvents)
    .set({ attempts: sql`${webhookEvents.attempts} + 1` })
    .where(eq(webhookEvents.id, webhookEventId));

  try {
    const event = provider.normalize(row.payload);
    let outcome: string;
    // El proveedor viene del adaptador que VERIFICÓ la firma, no del payload.
    if (event.kind === "message") outcome = await ingestMessage(provider.name, event);
    else if (event.kind === "status") outcome = await ingestStatus(provider.name, event);
    else outcome = `ignorado: ${event.reason}`;

    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), lastError: event.kind === "ignored" ? outcome : null })
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

async function ingestMessage(provider: ProviderName, event: NormalizedMessageEvent): Promise<string> {
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

  let phone: string;
  try {
    phone = canonicalPhone(normalizePhone(event.contactPhone));
  } catch {
    throw new PermanentIngestError(`teléfono de contacto inválido: ${event.contactPhone}`);
  }

  return db.transaction(async (tx) => {
    const orgId = channel.organizationId;
    const contactId = await findOrCreateContact(tx, orgId, phone, event.contactName);

    const [upserted] = await tx
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

    // Eco de un mensaje que el CRM mismo envió: ya existe la fila (en cola,
    // sin wamid). Se completa en lugar de duplicarla.
    let outcome: string | null = null;
    if (event.direction === "out") {
      const completed = await tx
        .update(messages)
        .set({ providerMessageId: event.providerMessageId, status: "sent", sentAt: event.sentAt })
        .where(
          and(
            eq(messages.organizationId, orgId),
            eq(messages.providerInternalId, event.providerInternalId),
            isNull(messages.providerMessageId),
          ),
        )
        .returning({ id: messages.id });
      if (completed.length > 0) outcome = "eco de envío del CRM enlazado";
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
          status: event.direction === "in" ? "received" : "sent",
          sentAt: event.sentAt,
        })
        .onConflictDoNothing({ target: messages.providerMessageId })
        .returning({ id: messages.id });
      if (inserted.length === 0) return "mensaje duplicado (wamid ya guardado)";
      outcome = event.direction === "in" ? "entrante guardado" : `saliente (${event.source}) guardado`;
    }

    // Se BLOQUEA la conversación antes de leer sus contadores: con varios
    // mensajes procesándose a la vez, leer-y-sumar en código perdería
    // incrementos de no leídos o movería la ventana hacia atrás.
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, upserted.id))
      .for("update");

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
    }
    // Primera respuesta: se reconcilia desde la base con CUALQUIER mensaje
    // nuevo (entrante o saliente), así da igual en qué orden lleguen sus
    // webhooks. Se fija una sola vez.
    if (conversation.firstResponseSeconds === null) {
      const seconds = await reconcileFirstResponse(tx, conversation.id);
      if (seconds !== null) updates.firstResponseSeconds = seconds;
    }
    await tx.update(conversations).set(updates).where(eq(conversations.id, conversation.id));
    return outcome;
  });
}

/**
 * Tras un saliente enviado desde el CRM: último mensaje y primera respuesta.
 * (El eco de ese envío llega como duplicado del wamid y no pasa por aquí.)
 */
export async function refreshConversationAfterOutbound(conversationId: string, sentAt: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (!conversation) return;
    const updates: Partial<typeof conversations.$inferInsert> = {
      unreadCount: 0,
      lastMessageAt:
        conversation.lastMessageAt && conversation.lastMessageAt > sentAt ? conversation.lastMessageAt : sentAt,
    };
    if (conversation.firstResponseSeconds === null) {
      const seconds = await reconcileFirstResponse(tx, conversationId);
      if (seconds !== null) updates.firstResponseSeconds = seconds;
    }
    await tx.update(conversations).set(updates).where(eq(conversations.id, conversationId));
  });
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

async function ingestStatus(provider: ProviderName, event: NormalizedStatusEvent): Promise<string> {
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

  return db.transaction(async (tx) => {
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
    const status = nextStatus(message.status, event.status);
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
  });
}
