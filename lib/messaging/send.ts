// Envío de texto desde el CRM (lo llama la server action del composer) con
// patrón outbox, para que un envío ambiguo NUNCA duplique el mensaje al cliente:
//
// 1. Valida conversación/organización y la ventana de 24 h: fuera de ella
//    solo se permiten plantillas (CLAUDE.md §5).
// 2. Guarda la fila "queued" ANTES de llamar al proveedor. Su id es la clave
//    de idempotencia del envío (Idempotency-Key): si la respuesta se pierde,
//    reintentar con la misma clave no manda un segundo mensaje.
// 3. Llama al proveedor y distingue:
//    - enviado → se enlaza el wamid (ver linkSentMessage);
//    - rechazado (el proveedor dijo que NO salió) → "failed" con su código;
//      se puede reintentar (retryTextMessage) sin riesgo;
//    - desconocido (timeout, corte, 5xx) → se queda "queued" con
//      error_code "send_unknown": NO se ofrece reintentar. Si el eco llega
//      con su id, se enlaza solo (ingest.ts); si no, el barrido del worker
//      (expireUnconfirmedSends) lo pasa a "failed" / send_unconfirmed.
//    Los errores nunca se tragan: quedan en error_code/error_message (§7).
// 4. El eco (message.sent) puede llegar ANTES que la respuesta de la API: si
//    ya existe una fila con ese wamid, esa fila se queda con la autoría
//    (source "crm", sent_by_user_id) y la de la cola se borra.
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, conversations, messages } from "@/lib/db/schema";
import { applyOutboundToConversation, latestInboundMessageId } from "./ingest";
import { SendFailedError, type MessagingProvider, type SendResult } from "./provider";
import { isAmbiguousSendError, isWindowOpen, nextStatus, SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";

export class SendRejectedError extends Error {
  constructor(
    readonly code: "not_found" | "window_closed" | "not_linked" | "empty" | "not_retryable" | "channel_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SendRejectedError";
  }
}

export type SendTextParams = {
  organizationId: string;
  conversationId: string;
  sentByUserId: string;
  text: string;
  now?: Date;
};

/** "sent": confirmado. "pending": resultado desconocido, en reconciliación (sin reintento). */
export type SendOutcome = { messageId: string; status: "sent" | "pending" };

export { isAmbiguousSendError, SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";
const MAX_TEXT = 4096; // límite de WhatsApp para texto

type ConversationRow = typeof conversations.$inferSelect;
type ChannelRow = typeof channels.$inferSelect;

async function loadConversation(provider: MessagingProvider, organizationId: string, conversationId: string, now: Date) {
  const [row] = await db
    .select({ conversation: conversations, channel: channels })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new SendRejectedError("not_found", "Conversación no encontrada");
  // Un canal desactivado no envía, y un canal de otro proveedor (p. ej. ya
  // migrado a Meta directa) no se manda por este adaptador.
  if (!row.channel.isActive || row.channel.provider !== provider.name) {
    throw new SendRejectedError("channel_unavailable", "El canal de WhatsApp de esta conversación no está disponible");
  }
  if (!isWindowOpen(row.conversation.windowExpiresAt, now)) {
    throw new SendRejectedError("window_closed", "La ventana de 24 h está cerrada: solo se puede enviar una plantilla");
  }
  if (!row.conversation.providerConversationId) {
    throw new SendRejectedError("not_linked", "La conversación aún no está enlazada con el proveedor");
  }
  return row;
}

function validText(raw: string): string {
  const text = raw.trim();
  if (!text) throw new SendRejectedError("empty", "El mensaje está vacío");
  if (text.length > MAX_TEXT) throw new SendRejectedError("empty", `El mensaje excede ${MAX_TEXT} caracteres`);
  return text;
}

export async function sendTextMessage(provider: MessagingProvider, params: SendTextParams): Promise<SendOutcome> {
  const text = validText(params.text);
  const now = params.now ?? new Date();
  const { conversation, channel } = await loadConversation(provider, params.organizationId, params.conversationId, now);

  const messageId = crypto.randomUUID();
  await db.insert(messages).values({
    id: messageId,
    organizationId: params.organizationId,
    conversationId: conversation.id,
    direction: "out",
    source: "crm",
    type: "text",
    body: text,
    status: "queued",
    sentByUserId: params.sentByUserId,
    sentAt: now,
  });
  return deliver(provider, { messageId, text, now, conversation, channel, organizationId: params.organizationId, sentByUserId: params.sentByUserId });
}

/**
 * ⚠ Reintentar: SOLO un mensaje "failed" por rechazo DEFINITIVO del proveedor
 * (4xx: el mensaje no salió). Un fallo ambiguo (timeout, 5xx, sin confirmar)
 * NO se reintenta: Zernio libera la clave de idempotencia al fallar, así que
 * reenviar podría duplicar el mensaje al cliente. Para esos, el vendedor
 * revisa el chat y escribe de nuevo (mensaje nuevo, clave nueva).
 */
export async function retryTextMessage(
  provider: MessagingProvider,
  params: { organizationId: string; messageId: string; sentByUserId: string; now?: Date },
): Promise<SendOutcome> {
  const now = params.now ?? new Date();
  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, params.messageId), eq(messages.organizationId, params.organizationId)))
    .limit(1);
  if (!message) throw new SendRejectedError("not_found", "Mensaje no encontrado");
  if (message.direction !== "out" || message.source !== "crm" || message.type !== "text" || !message.body) {
    throw new SendRejectedError("not_retryable", "Solo se reintentan textos enviados desde el CRM");
  }
  // Un envío ambiguo (no se sabe si llegó) NO se reintenta: podría duplicar.
  if (isAmbiguousSendError(message.errorCode)) {
    throw new SendRejectedError(
      "not_retryable",
      "No se sabe si este mensaje llegó. Revisa el chat en el celular y, si no llegó, escríbelo de nuevo.",
    );
  }
  const { conversation, channel } = await loadConversation(provider, params.organizationId, message.conversationId, now);

  // Paso atómico failed → queued: dos clics simultáneos no envían dos veces.
  const claimed = await db
    .update(messages)
    .set({ status: "queued", errorCode: null, errorMessage: null, sentByUserId: params.sentByUserId, sentAt: now })
    .where(
      and(
        eq(messages.id, message.id),
        eq(messages.organizationId, params.organizationId),
        eq(messages.status, "failed"),
        isNull(messages.providerMessageId),
      ),
    )
    .returning({ id: messages.id });
  // Un "failed" CON wamid lo rechazó WhatsApp después de aceptarlo: con la
  // misma clave Zernio devolvería la respuesta guardada sin reenviar. Ese se
  // escribe de nuevo (mensaje nuevo), no se reintenta.
  if (claimed.length === 0) throw new SendRejectedError("not_retryable", "El mensaje ya se envió, se está enviando o WhatsApp lo rechazó");

  return deliver(provider, {
    messageId: message.id,
    text: message.body,
    now,
    conversation,
    channel,
    organizationId: params.organizationId,
    sentByUserId: params.sentByUserId,
  });
}

async function deliver(
  provider: MessagingProvider,
  ctx: {
    messageId: string;
    text: string;
    now: Date;
    conversation: ConversationRow;
    channel: ChannelRow;
    organizationId: string;
    sentByUserId: string;
  },
): Promise<SendOutcome> {
  const where = and(eq(messages.id, ctx.messageId), eq(messages.organizationId, ctx.organizationId));
  // Corte de lectura: el último entrante que el vendedor tenía a la vista al
  // enviar. Lo que entre después sigue sin leer (aunque haya otros envíos).
  const readCutoffMessageId = await latestInboundMessageId(ctx.conversation.id);
  let result: SendResult;
  try {
    result = await provider.sendText({
      providerAccountId: ctx.channel.providerAccountId,
      providerConversationId: ctx.conversation.providerConversationId!,
      text: ctx.text,
      idempotencyKey: ctx.messageId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Cualquier error que no sea un rechazo EXPLÍCITO del proveedor se trata
    // como desconocido: es preferible verificar que duplicar.
    if (error instanceof SendFailedError && error.outcome === "rejected") {
      await db.update(messages).set({ status: "failed", errorCode: error.code, errorMessage: reason }).where(where);
      throw error;
    }
    const code = error instanceof SendFailedError ? `${SEND_UNKNOWN}:${error.code}` : SEND_UNKNOWN;
    await db.update(messages).set({ errorCode: code, errorMessage: reason }).where(where);
    console.error(`[send] resultado desconocido para ${ctx.messageId}; se reconciliará: ${reason}`);
    return { messageId: ctx.messageId, status: "pending" };
  }

  const finalId = await linkSentMessage({
    queuedId: ctx.messageId,
    conversationId: ctx.conversation.id,
    organizationId: ctx.organizationId,
    sentByUserId: ctx.sentByUserId,
    providerMessageId: result.providerMessageId,
    providerInternalId: result.providerInternalId,
    status: "sent",
    sentAt: ctx.now,
    readCutoffMessageId,
  });
  return { messageId: finalId, status: "sent" };
}

export class SendConflictError extends Error {}

/**
 * Enlaza una fila en cola con el mensaje que el proveedor confirmó y, en la
 * MISMA transacción, actualiza la conversación (último mensaje, primera
 * respuesta, no leídos hasta el corte): un corte a la mitad no deja el
 * mensaje enviado con la conversación vieja. Orden de bloqueo: conversación
 * → mensajes, igual que la ingesta.
 *
 * Si el eco del webhook ya creó OTRA fila con ese wamid, esa se queda (con la
 * autoría del vendedor) y la de la cola se borra: nunca dos burbujas del mismo
 * envío. Nunca se fusionan dos envíos del CRM: si el wamid ya es de otra fila
 * "crm", se lanza SendConflictError y la fila en cola queda como estaba.
 * Devuelve el id que sobrevive.
 */
export async function linkSentMessage(input: {
  queuedId: string;
  conversationId: string;
  organizationId: string;
  sentByUserId: string | null;
  providerMessageId?: string;
  providerInternalId?: string;
  status: "sent" | "delivered" | "read" | "failed";
  sentAt: Date;
  /** null = no descontar no leídos (p. ej. la reconciliación del worker). */
  readCutoffMessageId: string | null;
}): Promise<string> {
  const link = () =>
    db.transaction(async (tx) => {
      await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)))
        .for("update");
      const queuedWhere = and(eq(messages.id, input.queuedId), eq(messages.organizationId, input.organizationId));
      const [queued] = await tx.select().from(messages).where(queuedWhere).for("update");
      if (!queued) throw new Error(`mensaje en cola ${input.queuedId} no existe`);
      let survivor = queued.id;
      const [echo] = input.providerMessageId
        ? await tx
            .select({ id: messages.id, status: messages.status, source: messages.source })
            .from(messages)
            .where(and(eq(messages.providerMessageId, input.providerMessageId), eq(messages.organizationId, input.organizationId)))
            .for("update")
        : [];
      if (echo && echo.id !== queued.id) {
        if (echo.source === "crm") {
          throw new SendConflictError(`el wamid ${input.providerMessageId} ya pertenece al envío ${echo.id}`);
        }
        await tx
          .update(messages)
          .set({ source: "crm", sentByUserId: input.sentByUserId, status: nextStatus(echo.status, input.status) })
          .where(eq(messages.id, echo.id));
        await tx.delete(messages).where(queuedWhere);
        survivor = echo.id;
      } else {
        await tx
          .update(messages)
          .set({
            status: nextStatus(queued.status, input.status),
            errorCode: null,
            errorMessage: null,
            providerMessageId: input.providerMessageId ?? queued.providerMessageId,
            providerInternalId: input.providerInternalId ?? queued.providerInternalId,
          })
          .where(queuedWhere);
      }
      await applyOutboundToConversation(tx, input.conversationId, input.sentAt, input.readCutoffMessageId);
      return survivor;
    });
  try {
    return await link();
  } catch (error) {
    // Carrera mínima: el eco se insertó entre la búsqueda y el UPDATE (choca
    // con el wamid único). Al reintentar, la búsqueda ya lo encuentra.
    if ((error as { code?: string }).code !== "23505") throw error;
    return link();
  }
}

// Un envío de resultado desconocido que siguió sin confirmarse (ni por la
// respuesta ni por el eco) tras este tiempo pasa a "failed" y se puede revisar.
export const SEND_UNCONFIRMED_AFTER_MS = 15 * 60_000;

/**
 * Barrido del worker: envíos del CRM que siguen "queued" sin wamid tras
 * SEND_UNCONFIRMED_AFTER_MS desde su último intento (resultado desconocido, o
 * el proceso murió tras el POST) pasan a "failed" con error_code
 * send_unconfirmed.
 *
 * NO se intenta adivinar cuál saliente del proveedor es: Zernio no acepta un
 * id de correlación propio, y emparejar por texto y hora podría atribuirle al
 * vendedor un mensaje ajeno. Si el envío sí salió, su eco ya está en el hilo
 * (el vendedor lo ve). No se ofrece "Reintentar" para un envío sin confirmar:
 * Zernio libera la clave al fallar, así que reintentar podría duplicar; el
 * vendedor revisa el chat y, si no llegó, lo escribe de nuevo.
 */
export async function expireUnconfirmedSends(now = new Date()): Promise<number> {
  const expired = await db
    .update(messages)
    .set({
      status: "failed",
      errorCode: SEND_UNCONFIRMED,
      errorMessage: "WhatsApp no confirmó el envío. Revisa el chat antes de reintentar.",
    })
    .where(
      and(
        eq(messages.direction, "out"),
        eq(messages.source, "crm"),
        eq(messages.status, "queued"),
        isNull(messages.providerMessageId),
        // sent_at = último intento (un reintento lo renueva), no la creación.
        lt(messages.sentAt, new Date(now.getTime() - SEND_UNCONFIRMED_AFTER_MS)),
      ),
    )
    .returning({ id: messages.id });
  return expired.length;
}
