// Envío de un mensaje de texto desde el CRM (lo llamará la server action del
// composer; la UI es del track UI).
//
// 1. Valida conversación/organización y la ventana de 24 h: fuera de ella
//    solo se permiten plantillas (CLAUDE.md §5).
// 2. Guarda el mensaje "en cola" con quién lo envía ANTES de llamar al
//    proveedor: si el proceso muere a la mitad, queda rastro.
// 3. Llama al proveedor. Si falla, el error se guarda en el mensaje
//    (error_code/error_message) y se propaga: nunca se traga (CLAUDE.md §7).
// 4. Enlaza el id devuelto. El eco (message.sent) puede llegar ANTES que la
//    respuesta de la API: si ya existe una fila con ese wamid, esa fila se
//    queda con la autoría (source "crm", sent_by_user_id) y la de la cola se
//    borra, sin duplicar el mensaje en el hilo.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, conversations, messages } from "@/lib/db/schema";
import { refreshConversationAfterOutbound } from "./ingest";
import type { MessagingProvider } from "./provider";
import { isWindowOpen } from "./rules";

export class SendRejectedError extends Error {
  constructor(
    readonly code: "not_found" | "window_closed" | "not_linked" | "empty",
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

const MAX_TEXT = 4096; // límite de WhatsApp para texto

export async function sendTextMessage(provider: MessagingProvider, params: SendTextParams): Promise<{ messageId: string }> {
  const text = params.text.trim();
  if (!text) throw new SendRejectedError("empty", "El mensaje está vacío");
  if (text.length > MAX_TEXT) throw new SendRejectedError("empty", `El mensaje excede ${MAX_TEXT} caracteres`);

  const [row] = await db
    .select({ conversation: conversations, channel: channels })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.id, params.conversationId), eq(conversations.organizationId, params.organizationId)))
    .limit(1);
  if (!row) throw new SendRejectedError("not_found", "Conversación no encontrada");
  const { conversation, channel } = row;
  const now = params.now ?? new Date();
  if (!isWindowOpen(conversation.windowExpiresAt, now)) {
    throw new SendRejectedError("window_closed", "La ventana de 24 h está cerrada: solo se puede enviar una plantilla");
  }
  if (!conversation.providerConversationId) {
    throw new SendRejectedError("not_linked", "La conversación aún no está enlazada con el proveedor");
  }

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

  let result;
  try {
    result = await provider.sendText({
      providerAccountId: channel.providerAccountId,
      providerConversationId: conversation.providerConversationId,
      text,
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    await db
      .update(messages)
      .set({
        status: "failed",
        errorCode: typeof code === "string" ? code : "send_error",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(and(eq(messages.id, messageId), eq(messages.organizationId, params.organizationId)));
    throw error;
  }

  const link = () => db.transaction(async (tx) => {
    if (result.providerMessageId) {
      // ¿Ganó el eco la carrera? Entonces esa fila es el mensaje: se le da la
      // autoría y se descarta la de la cola.
      const [echo] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.providerMessageId, result.providerMessageId), eq(messages.organizationId, params.organizationId)))
        .for("update");
      if (echo) {
        await tx
          .update(messages)
          .set({ source: "crm", sentByUserId: params.sentByUserId })
          .where(eq(messages.id, echo.id));
        await tx.delete(messages).where(and(eq(messages.id, messageId), eq(messages.organizationId, params.organizationId)));
        return echo.id;
      }
    }
    await tx
      .update(messages)
      .set({
        status: "sent",
        providerMessageId: result.providerMessageId ?? null,
        providerInternalId: result.providerInternalId,
      })
      .where(and(eq(messages.id, messageId), eq(messages.organizationId, params.organizationId)));
    return messageId;
  });
  let finalId: string;
  try {
    finalId = await link();
  } catch (error) {
    // Carrera mínima: el eco se insertó entre la búsqueda y el UPDATE (choca
    // con el wamid único). Al reintentar, la búsqueda ya lo encuentra.
    if ((error as { code?: string }).code !== "23505") throw error;
    finalId = await link();
  }

  // El vendedor contestó: conversación leída, último mensaje y primera respuesta.
  await refreshConversationAfterOutbound(conversation.id, now);

  return { messageId: finalId };
}
