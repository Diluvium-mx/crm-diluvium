"use server";

// Server Actions de la bandeja: la cara que consume la UI. Resuelven la
// organización activa desde la SESIÓN (nunca del cliente) y delegan en
// queries.ts / send.ts. Toda escritura y lectura queda acotada a esa
// organización (CLAUDE.md §7).
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { messagingProvider, MessagingNotConfiguredError } from "@/lib/messaging";
import {
  getConversationByContactForOrg,
  getConversationForOrg,
  listConversationsForOrg,
  listMessagesForOrg,
  markConversationReadForOrg,
  setConversationStarredForOrg,
} from "./queries";
import { retryTextMessage, SendRejectedError, sendTemplateMessage, sendTextMessage } from "@/lib/messaging/send";
import { SendFailedError } from "@/lib/messaging/provider";
import type {
  ConversationDetail,
  ConversationPage,
  InboxFilter,
  MessagePage,
  SendErrorCode,
  SendMessageResult,
} from "./types";

export async function listConversations(params: {
  filter?: InboxFilter;
  search?: string;
  cursor?: string | null;
} = {}): Promise<ConversationPage> {
  const { organizationId } = await requireActiveMembership();
  return listConversationsForOrg(organizationId, params);
}

export async function getConversation(conversationId: string): Promise<ConversationDetail | null> {
  const { organizationId } = await requireActiveMembership();
  return getConversationForOrg(organizationId, conversationId);
}

export async function getConversationByContact(contactId: string): Promise<ConversationDetail | null> {
  const { organizationId } = await requireActiveMembership();
  return getConversationByContactForOrg(organizationId, contactId);
}

export async function listMessages(
  conversationId: string,
  params: { before?: string | null; limit?: number } = {},
): Promise<MessagePage | null> {
  const { organizationId } = await requireActiveMembership();
  return listMessagesForOrg(organizationId, conversationId, params);
}

export async function markConversationRead(conversationId: string, upToMessageId?: string | null): Promise<void> {
  const { organizationId } = await requireActiveMembership();
  await markConversationReadForOrg(organizationId, conversationId, upToMessageId);
}

export async function setConversationStarred(conversationId: string, starred: boolean): Promise<void> {
  const { organizationId } = await requireActiveMembership();
  await setConversationStarredForOrg(organizationId, conversationId, starred);
}

// El código que la UI mapea a un mensaje amable; el texto es el respaldo.
function toSendError(error: unknown): { code: SendErrorCode; message: string } {
  if (error instanceof SendRejectedError) {
    const code: SendErrorCode = error.code === "empty" ? "empty" : error.code;
    return { code, message: error.message };
  }
  if (error instanceof MessagingNotConfiguredError) {
    return { code: "not_configured", message: "El canal de WhatsApp no está configurado." };
  }
  // Rechazo explícito del proveedor (4xx): no salió y se puede reintentar.
  if (error instanceof SendFailedError && error.outcome === "rejected") {
    return { code: "provider_rejected", message: "WhatsApp rechazó el mensaje. Puedes reintentarlo." };
  }
  // Resultado desconocido: el mensaje queda "enviando" y se resuelve solo. No
  // es un error que el vendedor deba ver como fallo.
  throw error;
}

export async function sendMessage(conversationId: string, text: string): Promise<SendMessageResult> {
  const { organizationId, userId } = await requireActiveMembership();
  try {
    const { messageId, status } = await sendTextMessage(messagingProvider(), {
      organizationId,
      conversationId,
      sentByUserId: userId,
      text,
    });
    return { ok: true, messageId, pending: status === "pending" };
  } catch (error) {
    const { code, message } = toSendError(error);
    return { ok: false, code, message };
  }
}

// Envía una plantilla aprobada en la conversación (para FUERA de la ventana de
// 24 h). `variableValues` van en orden ({{1}}, {{2}}, …).
export async function sendTemplate(
  conversationId: string,
  templateId: string,
  variableValues: string[],
): Promise<SendMessageResult> {
  const { organizationId, userId } = await requireActiveMembership();
  try {
    const { messageId, status } = await sendTemplateMessage(messagingProvider(), {
      organizationId,
      conversationId,
      sentByUserId: userId,
      templateId,
      variableValues,
    });
    return { ok: true, messageId, pending: status === "pending" };
  } catch (error) {
    const { code, message } = toSendError(error);
    return { ok: false, code, message };
  }
}

export async function retryMessage(messageId: string): Promise<SendMessageResult> {
  const { organizationId, userId } = await requireActiveMembership();
  try {
    const { messageId: id, status } = await retryTextMessage(messagingProvider(), {
      organizationId,
      messageId,
      sentByUserId: userId,
    });
    return { ok: true, messageId: id, pending: status === "pending" };
  } catch (error) {
    const { code, message } = toSendError(error);
    return { ok: false, code, message };
  }
}
