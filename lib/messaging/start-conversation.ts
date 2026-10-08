// Primer mensaje a un contacto SIN chat (28-sep-2026): contactos dados de alta a
// mano ("Nuevo contacto" del Embudo) o importados de GHL que nunca escribieron.
// Con el número oficial, a quien no escribió en las últimas 24 h solo se le puede
// mandar una PLANTILLA aprobada (regla de Meta). Mismo patrón outbox que el resto:
//
// 1. El contacto necesita teléfono. Si OTRO contacto más antiguo tiene el mismo
//    número (duplicados de GHL), el chat quedaría en ese (así resuelve la entrada:
//    ingest.ts, el más antiguo gana): se avisa y no se manda nada.
// 2. Si el contacto ya tiene conversación enlazada, es un envío normal
//    (sendTemplateMessage).
// 3. Si no: se crea la fila de conversación (sin id de Zernio todavía) y el
//    mensaje "queued"; se abre el hilo en Zernio con la plantilla
//    (POST /v1/inbox/conversations); con la respuesta se enlazan conversación y
//    mensaje (linkSentMessage). Si el eco llega antes, la entrada ya adopta esta
//    misma fila por (canal, contacto).
// 4. Rechazado o saturado (no salió): se borra lo creado y se lanza (el vendedor
//    ve el motivo). Desconocido (pudo salir): queda "enviando", sin reintento; el
//    eco lo confirma o el barrido lo explica, igual que un envío normal.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages } from "@/lib/db/schema";
import { phoneLookupVariants } from "@/lib/phone";
import { SendFailedError, type MessagingProvider, type StartConversationResult } from "./provider";
import { SEND_UNKNOWN } from "./rules";
import { linkSentMessage, loadSendableTemplate, saveAcceptedSend, SendRejectedError, sendTemplateMessage, templateSendValues } from "./send";
import { safeErrorMessage } from "@/lib/log/safe-error";

export type StartChatParams = {
  organizationId: string;
  contactId: string;
  templateId: string;
  variableValues: string[];
  sentByUserId: string;
  now?: Date;
};

export type StartChatOutcome = { conversationId: string; messageId: string; status: "sent" | "pending" };

/** Otro contacto (más antiguo) tiene el mismo número: el chat quedaría en él. */
export class DuplicatePhoneError extends SendRejectedError {
  constructor(
    readonly otherContactId: string,
    otherName: string,
  ) {
    super("duplicate_phone", `Este número también está en el contacto «${otherName}» (el más antiguo): el chat quedaría ahí. Escríbele desde ese contacto.`);
    this.name = "DuplicatePhoneError";
  }
}

export async function startConversationWithTemplate(provider: MessagingProvider, params: StartChatParams): Promise<StartChatOutcome> {
  const now = params.now ?? new Date();
  const { organizationId } = params;

  const [contact] = await db
    .select({ id: contacts.id, phoneE164: contacts.phoneE164 })
    .from(contacts)
    .where(and(eq(contacts.id, params.contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!contact) throw new SendRejectedError("not_found", "Contacto no encontrado.");
  if (!contact.phoneE164) throw new SendRejectedError("no_phone", "Este contacto no tiene teléfono: agrégalo para poder escribirle.");

  // El más antiguo con ese número es el que recibe el chat (misma regla que la entrada).
  const [owner] = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.phoneE164, phoneLookupVariants(contact.phoneE164))))
    .orderBy(asc(contacts.createdAt), asc(contacts.id))
    .limit(1);
  if (owner && owner.id !== contact.id) {
    throw new DuplicatePhoneError(owner.id, [owner.firstName, owner.lastName].filter(Boolean).join(" ") || contact.phoneE164);
  }

  const [channel] = await db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, organizationId),
        eq(channels.type, "whatsapp"),
        eq(channels.provider, provider.name),
        eq(channels.isActive, true),
      ),
    )
    // El más nuevo, igual que Plantillas (activeWhatsappChannel): v1 tiene uno.
    .orderBy(desc(channels.createdAt))
    .limit(1);
  if (!channel) throw new SendRejectedError("channel_unavailable", "No hay un canal de WhatsApp activo.");

  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.channelId, channel.id), eq(conversations.contactId, contact.id)))
    .limit(1);
  // Ya tiene chat enlazado: envío normal de plantilla en su conversación.
  if (existing?.providerConversationId) {
    const out = await sendTemplateMessage(provider, {
      organizationId,
      conversationId: existing.id,
      sentByUserId: params.sentByUserId,
      templateId: params.templateId,
      variableValues: params.variableValues,
      now,
    });
    return { conversationId: existing.id, ...out };
  }

  const template = await loadSendableTemplate(organizationId, channel, params.templateId);
  const { values, preview } = templateSendValues(template.body, params.variableValues);
  if (!provider.startConversationWithTemplate) {
    throw new SendRejectedError("channel_unavailable", "Este canal no permite abrir chats nuevos desde el CRM.");
  }

  // Fila de la conversación (sin id de Zernio) + mensaje en cola, antes de llamar a nadie.
  let conversationId = existing?.id ?? null;
  const createdHere = conversationId === null;
  if (conversationId === null) {
    const [created] = await db
      .insert(conversations)
      .values({ id: crypto.randomUUID(), organizationId, contactId: contact.id, channelId: channel.id, lastMessageAt: now })
      .onConflictDoNothing({ target: [conversations.channelId, conversations.contactId] })
      .returning({ id: conversations.id });
    conversationId =
      created?.id ??
      (
        await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.channelId, channel.id), eq(conversations.contactId, contact.id)))
          .limit(1)
      )[0]?.id ??
      null;
    if (conversationId === null) throw new SendRejectedError("not_found", "No se pudo preparar el chat; inténtalo de nuevo.");
  }

  const messageId = crypto.randomUUID();
  await db.insert(messages).values({
    id: messageId,
    organizationId,
    conversationId,
    direction: "out",
    source: "crm",
    type: "template",
    body: preview,
    templateName: template.name,
    metadata: { plantilla: { name: template.name, language: template.language, bodyParams: values } },
    status: "queued",
    sentByUserId: params.sentByUserId,
    sentAt: now,
  });

  let result: StartConversationResult;
  try {
    result = await provider.startConversationWithTemplate({
      providerAccountId: channel.providerAccountId,
      phoneE164: contact.phoneE164,
      name: template.name,
      language: template.language,
      bodyParams: values,
      idempotencyKey: messageId,
    });
  } catch (error) {
    const reason = safeErrorMessage(error);
    if (error instanceof SendFailedError && error.outcome !== "unknown") {
      // No salió (rechazado o saturado): no queda rastro; el vendedor ve el motivo.
      await db.delete(messages).where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)));
      if (createdHere) {
        await db
          .delete(conversations)
          .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)));
      }
      throw error;
    }
    const code = error instanceof SendFailedError ? `${SEND_UNKNOWN}:${error.code}` : SEND_UNKNOWN;
    await db
      .update(messages)
      .set({ errorCode: code, errorMessage: reason.slice(0, 500) })
      .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)));
    console.error(`[start-conversation] resultado desconocido para ${messageId}; se reconciliará: ${reason}`);
    return { conversationId, messageId, status: "pending" };
  }

  // Zernio YA lo aceptó: nada de lo que falle desde aquí lo vuelve "error".
  try {
    await db
      .update(conversations)
      .set({ providerConversationId: result.providerConversationId })
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)));
    const finalId = await linkSentMessage({
      queuedId: messageId,
      conversationId,
      organizationId,
      sentByUserId: params.sentByUserId,
      providerMessageId: result.providerMessageId,
      providerInternalId: result.providerInternalId,
      status: "sent",
      sentAt: now,
      readCutoffMessageId: null,
    });
    return { conversationId, messageId: finalId, status: "sent" };
  } catch (error) {
    const reason = safeErrorMessage(error);
    console.error(`[start-conversation] Zernio aceptó ${messageId} pero no se pudo guardar la confirmación: ${reason}`);
    await saveAcceptedSend(messageId, organizationId, result, reason);
    return { conversationId, messageId, status: "pending" };
  }
}
