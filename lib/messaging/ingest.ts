// Aplica un evento normalizado a la base (lo usa el worker). Toda consulta
// filtra por organización: la organización sale del CANAL (el número de
// WhatsApp conectado), nunca del payload.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages, webhookEvents } from "@/lib/db/schema";
import { canonicalPhone, normalizePhone, phoneLookupVariants } from "@/lib/phone";
import type { MessagingProvider, NormalizedMessageEvent, NormalizedStatusEvent } from "./provider";
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
    if (event.kind === "message") outcome = await ingestMessage(event);
    else if (event.kind === "status") outcome = await ingestStatus(event);
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

async function ingestMessage(event: NormalizedMessageEvent): Promise<string> {
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.providerAccountId, event.providerAccountId), eq(channels.isActive, true)))
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

    const [conversation] = await tx
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
      if (completed.length > 0) return "eco de envío del CRM enlazado";
    }

    const first = event.attachments[0];
    const inserted = await tx
      .insert(messages)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        conversationId: conversation.id,
        direction: event.direction,
        source: event.source,
        type: event.type,
        body: event.body,
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

    const updates: Partial<typeof conversations.$inferInsert> = {
      lastMessageAt:
        conversation.lastMessageAt && conversation.lastMessageAt > event.sentAt
          ? conversation.lastMessageAt
          : event.sentAt,
    };
    if (event.direction === "in") {
      updates.unreadCount = conversation.unreadCount + 1;
      updates.windowExpiresAt = windowExpiresAt(event.sentAt, conversation.windowExpiresAt);
      updates.status = "open";
    } else if (conversation.firstResponseSeconds === null && event.source !== "other_api") {
      const [firstInbound] = await tx
        .select({ sentAt: messages.sentAt })
        .from(messages)
        .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "in")))
        .orderBy(asc(messages.sentAt))
        .limit(1);
      const seconds = firstResponseSeconds(firstInbound?.sentAt ?? null, event.sentAt);
      if (seconds !== null) updates.firstResponseSeconds = seconds;
    }
    await tx.update(conversations).set(updates).where(eq(conversations.id, conversation.id));

    return event.direction === "in" ? "entrante guardado" : `saliente (${event.source}) guardado`;
  });
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

async function ingestStatus(event: NormalizedStatusEvent): Promise<string> {
  // La organización sale del canal (cuenta del proveedor), nunca de un id de
  // mensaje suelto: un estado jamás toca mensajes de otra organización.
  let orgId: string | undefined;
  if (event.providerAccountId) {
    const [channel] = await db
      .select({ organizationId: channels.organizationId })
      .from(channels)
      .where(eq(channels.providerAccountId, event.providerAccountId))
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

  const [message] = await db.select().from(messages).where(match).limit(1);
  if (!message) {
    // El estado llegó antes que el mensaje (o su eco): reintentar más tarde.
    throw new RetryableIngestError("mensaje del estado aún no existe");
  }
  if (orgId && message.organizationId !== orgId) {
    throw new PermanentIngestError("el estado apunta a un mensaje de otra organización; se rechaza");
  }
  const status = nextStatus(message.status, event.status);
  await db
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
}
