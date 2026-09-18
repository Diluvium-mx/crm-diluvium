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
//      error_code "send_unknown": NO se ofrece reintentar. El barrido del
//      worker (reconcilePendingSends) lo busca en el proveedor y lo enlaza, o
//      tras SEND_UNCONFIRMED_AFTER_MS sin rastro lo pasa a "failed".
//    Los errores nunca se tragan: quedan en error_code/error_message (§7).
// 4. El eco (message.sent) puede llegar ANTES que la respuesta de la API: si
//    ya existe una fila con ese wamid, esa fila se queda con la autoría
//    (source "crm", sent_by_user_id) y la de la cola se borra.
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, conversations, messages } from "@/lib/db/schema";
import { refreshConversationAfterOutbound } from "./ingest";
import { SendFailedError, type MessagingProvider, type SendResult } from "./provider";
import { isWindowOpen, nextStatus } from "./rules";

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

export const SEND_UNKNOWN = "send_unknown";
export const SEND_UNCONFIRMED = "send_unconfirmed";
// Zernio guarda la clave de idempotencia 24 h; se deja 1 h de margen.
export const SAFE_RETRY_WINDOW_MS = 23 * 3600_000;
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
 * ⚠ Reintentar: solo un mensaje "failed" (el proveedor lo rechazó, o la
 * reconciliación no encontró rastro de él). Reusa la MISMA fila y por tanto la
 * misma clave de idempotencia: si el intento original sí había salido, el
 * proveedor devuelve la respuesta guardada y no manda un duplicado.
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
  // Un envío AMBIGUO (sin confirmar) solo se reintenta mientras el proveedor
  // recuerda la clave de idempotencia del PRIMER intento (created_at no cambia
  // con los reintentos): si aquel sí salió, el proveedor contesta con la
  // respuesta guardada y no duplica. Pasado ese plazo, reintentar podría
  // mandar el mensaje dos veces: el vendedor debe revisar el chat y escribirlo
  // de nuevo a conciencia.
  if (message.errorCode === SEND_UNCONFIRMED && now.getTime() - message.createdAt.getTime() > SAFE_RETRY_WINDOW_MS) {
    throw new SendRejectedError(
      "not_retryable",
      "Ya no se puede reintentar sin riesgo de duplicarlo: revisa el chat en el celular y, si no llegó, escríbelo de nuevo",
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
    organizationId: ctx.organizationId,
    sentByUserId: ctx.sentByUserId,
    providerMessageId: result.providerMessageId,
    providerInternalId: result.providerInternalId,
    status: "sent",
  });
  // El vendedor contestó: último mensaje y primera respuesta. Solo se
  // descuentan los no leídos que ya existían al abrir el envío: un entrante que
  // llegó mientras tanto sigue sin leer.
  await refreshConversationAfterOutbound(ctx.conversation.id, ctx.now, { seenUnread: ctx.conversation.unreadCount });
  return { messageId: finalId, status: "sent" };
}

/**
 * Enlaza una fila en cola con el mensaje que el proveedor confirmó. Si el eco
 * del webhook ya creó OTRA fila con ese wamid, esa se queda (con la autoría
 * del vendedor) y la de la cola se borra: nunca dos burbujas del mismo envío.
 * Devuelve el id que sobrevive.
 */
export async function linkSentMessage(input: {
  queuedId: string;
  organizationId: string;
  sentByUserId: string | null;
  providerMessageId?: string;
  providerInternalId?: string;
  status: "sent" | "delivered" | "read" | "failed";
}): Promise<string> {
  const link = () =>
    db.transaction(async (tx) => {
      const queuedWhere = and(eq(messages.id, input.queuedId), eq(messages.organizationId, input.organizationId));
      const [queued] = await tx.select().from(messages).where(queuedWhere).for("update");
      if (!queued) throw new Error(`mensaje en cola ${input.queuedId} no existe`);
      if (input.providerMessageId) {
        const [echo] = await tx
          .select({ id: messages.id, status: messages.status })
          .from(messages)
          .where(and(eq(messages.providerMessageId, input.providerMessageId), eq(messages.organizationId, input.organizationId)))
          .for("update");
        if (echo && echo.id !== queued.id) {
          await tx
            .update(messages)
            .set({ source: "crm", sentByUserId: input.sentByUserId, status: nextStatus(echo.status, input.status) })
            .where(eq(messages.id, echo.id));
          await tx.delete(messages).where(queuedWhere);
          return echo.id;
        }
      }
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
      return queued.id;
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

// Sin rastro del envío en el proveedor tras este tiempo (el eco suele llegar
// en segundos), se da por no enviado y se permite reintentar.
export const SEND_UNCONFIRMED_AFTER_MS = 15 * 60_000;
const RECONCILE_MIN_AGE_MS = 2 * 60_000;
// Se compara contra salientes del proveedor desde un poco antes de la fila
// (relojes distintos).
const CLOCK_SKEW_MS = 2 * 60_000;

/**
 * Barrido del worker: envíos del CRM que siguen "queued" sin wamid (resultado
 * desconocido, o el proceso murió tras el POST). Se buscan entre los últimos
 * salientes de la conversación en el proveedor (mismo texto, desde la hora de
 * la fila, con un wamid que ningún otro envío del CRM haya reclamado).
 * Encontrado → se enlaza. Sin rastro y viejo → "failed" (ya se puede
 * reintentar, con la misma clave de idempotencia). Error del proveedor al
 * listar → se deja para el siguiente barrido.
 */
export async function reconcilePendingSends(provider: MessagingProvider, now = new Date()): Promise<{ linked: number; failed: number }> {
  const pending = await db
    .select({ message: messages, conversation: conversations, channel: channels })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(
      and(
        eq(messages.direction, "out"),
        eq(messages.source, "crm"),
        eq(messages.status, "queued"),
        isNull(messages.providerMessageId),
        eq(channels.provider, provider.name),
        // sent_at = último intento (un reintento lo renueva), no la creación.
        lt(messages.sentAt, new Date(now.getTime() - RECONCILE_MIN_AGE_MS)),
      ),
    )
    .limit(20);

  let linked = 0;
  let failed = 0;
  for (const { message, conversation, channel } of pending) {
    if (!conversation.providerConversationId) continue;
    let candidates;
    try {
      candidates = await provider.listRecentOutgoing({
        providerAccountId: channel.providerAccountId,
        providerConversationId: conversation.providerConversationId,
      });
    } catch (error) {
      console.error(`[send] no se pudo reconciliar ${message.id}; siguiente barrido`, error);
      continue;
    }
    const attemptAt = (message.sentAt ?? message.createdAt).getTime();
    const since = attemptAt - CLOCK_SKEW_MS;
    const sameText = candidates.filter((c) => c.text?.trim() === message.body && c.at.getTime() >= since);
    // Wamids ya reclamados por OTRO envío del CRM (el mismo texto dos veces).
    const claimed = sameText.length
      ? await db
          .select({ wamid: messages.providerMessageId })
          .from(messages)
          .where(
            and(
              eq(messages.organizationId, message.organizationId),
              eq(messages.source, "crm"),
              inArray(
                messages.providerMessageId,
                sameText.map((c) => c.providerMessageId),
              ),
            ),
          )
      : [];
    const claimedIds = new Set(claimed.map((c) => c.wamid));
    // El más viejo sin reclamar: con dos envíos idénticos, se emparejan en orden.
    const match = sameText.filter((c) => !claimedIds.has(c.providerMessageId)).sort((a, b) => a.at.getTime() - b.at.getTime())[0];

    if (match) {
      await linkSentMessage({
        queuedId: message.id,
        organizationId: message.organizationId,
        sentByUserId: message.sentByUserId,
        providerMessageId: match.providerMessageId,
        status: match.status ?? "sent",
      });
      await refreshConversationAfterOutbound(conversation.id, message.sentAt ?? message.createdAt, { seenUnread: 0 });
      linked++;
      continue;
    }
    if (attemptAt < now.getTime() - SEND_UNCONFIRMED_AFTER_MS) {
      const marked = await db
        .update(messages)
        .set({
          status: "failed",
          errorCode: SEND_UNCONFIRMED,
          errorMessage: "WhatsApp no confirmó el envío. Revisa el chat antes de reintentar.",
        })
        .where(and(eq(messages.id, message.id), eq(messages.status, "queued"), isNull(messages.providerMessageId)))
        .returning({ id: messages.id });
      failed += marked.length;
    }
  }
  return { linked, failed };
}

