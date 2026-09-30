"use server";

// Server Actions de la bandeja: la cara que consume la UI. Resuelven la
// organización activa desde la SESIÓN (nunca del cliente) y delegan en
// queries.ts / send.ts. Toda escritura y lectura queda acotada a esa
// organización (CLAUDE.md §7).
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { isTemperatureFilter } from "@/lib/contacts/filters";
import { chatSearchTerm } from "@/lib/text/search";
import { messagingProvider, MessagingNotConfiguredError } from "@/lib/messaging";
import {
  getConversationByContactForOrg,
  getConversationForOrg,
  listConversationItemsByIdsForOrg,
  listConversationsForOrg,
  listMessagesForOrg,
  markConversationReadForOrg,
  setContactUnreadForOrg,
  setConversationUnreadForOrg,
} from "./queries";
import { listChatMatchIdsForOrg, searchChatsByContactForOrg } from "./chat-search";
import { retryTextMessage, SendRejectedError, sendTemplateMessage, sendTextMessage } from "@/lib/messaging/send";
import { DuplicatePhoneError, startConversationWithTemplate } from "@/lib/messaging/start-conversation";
import { submitNotice, type MetaNotice } from "@/lib/templates/meta-reasons";
import { SendFailedError } from "@/lib/messaging/provider";
import { enqueueOutboxSend } from "@/lib/queue/outbox";
import { plainSendReason } from "@/lib/messaging/send-reasons";
import { pauseAgentForManualSend, pauseAgentOnManualMessageId } from "@/lib/ai/runtime/hooks";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationPage,
  InboxListParams,
  MessagePage,
  SendErrorCode,
  SendMessageResult,
} from "./types";

// Lo que llega del navegador: la pestaña y la temperatura se validan (un valor raro
// cae al valor por defecto); búsqueda y cursor los sanean las consultas.
function listParams(params: InboxListParams): InboxListParams {
  return {
    filter: params.filter === "unread" || params.filter === "starred" ? params.filter : "all",
    temperature: isTemperatureFilter(params.temperature) ? params.temperature : null,
    search: typeof params.search === "string" ? params.search : undefined,
    searchChats: params.searchChats === true,
  };
}

export async function listConversations(params: InboxListParams & { cursor?: string | null } = {}): Promise<ConversationPage> {
  const { organizationId } = await requireActiveMembership();
  return listConversationsForOrg(organizationId, { ...listParams(params), cursor: params.cursor });
}

/**
 * Filas frescas de la lista para ciertas conversaciones (tiempo real: la UI
 * actualiza solo las afectadas). Aplica el mismo filtro/búsqueda que la lista:
 * una que ya no pasa el filtro no vuelve (la UI la quita).
 */
export async function getConversationItems(
  conversationIds: string[],
  params: InboxListParams = {},
): Promise<ConversationListItem[]> {
  const { organizationId } = await requireActiveMembership();
  return listConversationItemsByIdsForOrg(organizationId, conversationIds.slice(0, 100), listParams(params));
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

const chatSearchInput = z.string().max(500);
const conversationIdInput = z.string().min(1).max(128);

/**
 * Embudo con la lupa amarilla: por contacto, cuántos mensajes de sus chats tienen la
 * palabra ([contactId, cuántos]). Con menos de 3 letras no busca (lista vacía).
 */
export async function searchChatsByContact(search: string): Promise<Array<[string, number]>> {
  const { organizationId } = await requireActiveMembership();
  const term = chatSearchTerm(chatSearchInput.parse(search));
  return term ? searchChatsByContactForOrg(organizationId, term) : [];
}

/** Chat abierto con la lupa amarilla: ids de los mensajes con la palabra, del más reciente al más viejo. */
export async function listChatMatches(conversationId: string, search: string): Promise<string[]> {
  const { organizationId } = await requireActiveMembership();
  const id = conversationIdInput.parse(conversationId);
  const term = chatSearchTerm(chatSearchInput.parse(search));
  return term ? listChatMatchIdsForOrg(organizationId, id, term) : [];
}

export async function markConversationRead(conversationId: string, upToMessageId?: string | null): Promise<void> {
  const { organizationId } = await requireActiveMembership();
  await markConversationReadForOrg(organizationId, conversationId, upToMessageId);
}

const unreadInput = z.object({ id: z.string().min(1).max(128), unread: z.boolean() });

// Clic derecho → "Marcar como no leído / leído" en la Bandeja (una conversación).
export async function setConversationUnread(conversationId: string, unread: boolean): Promise<void> {
  const { organizationId } = await requireActiveMembership();
  const input = unreadInput.parse({ id: conversationId, unread });
  await setConversationUnreadForOrg(organizationId, input.id, input.unread);
}

// Lo mismo desde la tarjeta del Embudo (un contacto). false = aún no tiene chat.
export async function setContactUnread(contactId: string, unread: boolean): Promise<boolean> {
  const { organizationId } = await requireActiveMembership();
  const input = unreadInput.parse({ id: contactId, unread });
  return setContactUnreadForOrg(organizationId, input.id, input.unread);
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
    return { code: "provider_rejected", message: `No salió: ${plainSendReason(error.code, error.message)}.` };
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
      // Si Zernio pide esperar (429), la pantalla no se traba: lo manda el worker.
      deferTo: enqueueOutboxSend,
    });
    // Un mensaje manual del vendedor pausa al Agente IA en esta conversación.
    await pauseAgentForManualSend(organizationId, conversationId);
    return { ok: true, messageId, pending: status === "pending" };
  } catch (error) {
    const { code, message } = toSendError(error);
    return { ok: false, code, message };
  }
}

// S2 (CN-014, "Zod en todo borde"): ids acotados y variables solo texto, con tope
// por valor y por cantidad (un valor no texto tronaba como error genérico; uno
// enorme se guardaba y se mandaba a Zernio).
const templateSendInput = z.object({
  id: z.string().min(1).max(128),
  templateId: z.string().min(1).max(128),
  variableValues: z.array(z.string().max(1_024)).max(50),
});
const TEMPLATE_INPUT_ERROR = "Los datos de la plantilla no son válidos (cada variable es texto de hasta 1,024 caracteres).";

// Envía una plantilla aprobada en la conversación (para FUERA de la ventana de
// 24 h). `variableValues` van en orden ({{1}}, {{2}}, …).
export async function sendTemplate(
  conversationId: string,
  templateId: string,
  variableValues: string[],
): Promise<SendMessageResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const input = templateSendInput.safeParse({ id: conversationId, templateId, variableValues });
  if (!input.success) return { ok: false, code: "template_params", message: TEMPLATE_INPUT_ERROR };
  ({ id: conversationId, templateId, variableValues } = input.data);
  try {
    const { messageId, status } = await sendTemplateMessage(messagingProvider(), {
      organizationId,
      conversationId,
      sentByUserId: userId,
      templateId,
      variableValues,
      deferTo: enqueueOutboxSend,
    });
    await pauseAgentForManualSend(organizationId, conversationId);
    return { ok: true, messageId, pending: status === "pending" };
  } catch (error) {
    const { code, message } = toSendError(error);
    return { ok: false, code, message };
  }
}

/** Primer mensaje a un contacto sin chat: cómo le fue (con el aviso grande si fue Meta). */
export type StartChatResult =
  | { ok: true; conversationId: string; pending: boolean }
  | {
      ok: false;
      code: SendErrorCode;
      message: string;
      /** WhatsApp (Meta) lo rechazó: aviso grande (decisión del dueño, 28-sep-2026). */
      notice?: MetaNotice;
      /** duplicate_phone: el contacto más antiguo con ese número, para abrirlo. */
      otherContactId?: string;
    };

// Primer mensaje a un contacto SIN chat (Embudo → pop-up del contacto): abre el
// hilo en WhatsApp con una plantilla aprobada (lib/messaging/start-conversation.ts).
export async function startChatWithTemplate(contactId: string, templateId: string, variableValues: string[]): Promise<StartChatResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const input = templateSendInput.safeParse({ id: contactId, templateId, variableValues });
  if (!input.success) return { ok: false, code: "template_params", message: TEMPLATE_INPUT_ERROR };
  ({ id: contactId, templateId, variableValues } = input.data);
  try {
    const out = await startConversationWithTemplate(messagingProvider(), {
      organizationId,
      contactId,
      templateId,
      variableValues,
      sentByUserId: userId,
    });
    // Mensaje del vendedor: pausa al Agente IA en ese chat, como cualquier envío manual.
    await pauseAgentForManualSend(organizationId, out.conversationId);
    return { ok: true, conversationId: out.conversationId, pending: out.status === "pending" };
  } catch (error) {
    if (error instanceof DuplicatePhoneError) {
      return { ok: false, code: "duplicate_phone", message: error.message, otherContactId: error.otherContactId };
    }
    if (error instanceof SendFailedError && error.outcome === "rate_limited") {
      return { ok: false, code: "provider_rejected", message: "WhatsApp está saturado en este momento: espera un minuto y vuelve a intentarlo." };
    }
    if (error instanceof SendFailedError && error.outcome === "rejected") {
      return {
        ok: false,
        code: "provider_rejected",
        message: `No salió: ${plainSendReason(error.code, error.message)}.`,
        notice: submitNotice("enviar", error.message),
      };
    }
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
      deferTo: enqueueOutboxSend,
    });
    await pauseAgentOnManualMessageId(organizationId, id);
    return { ok: true, messageId: id, pending: status === "pending" };
  } catch (error) {
    const { code, message } = toSendError(error);
    return { ok: false, code, message };
  }
}
