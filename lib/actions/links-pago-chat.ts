"use server";

// Links de pago en el chat (30-oct-2026, pestaña «Links de pago» del ⚡; reglas en lib/agente-ia/links-pago.ts):
// el vendedor elige un link y salen los dos mensajes en orden (el del link y, aparte, el de los datos de envío),
// como mensajes suyos (pausan al Agente IA igual que cualquier mensaje manual). Salen todos los links, también los
// «Solo vendedor». Nunca a un número de fuera de México (los +1 sí). La organización sale de la SESIÓN.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { mensajesLink, type LinkPago, type TextosLink } from "@/lib/agente-ia/links-pago";
import { listLinksPago, loadTextosLink, paisSinLinksDelChat } from "@/lib/agente-ia/links-pago-store";
import { pauseAgentForManualSend } from "@/lib/ai/runtime/hooks";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { moveStageForward } from "@/lib/contacts/stage";
import { roleKey } from "@/lib/contacts/stages";
import { messagingProvider } from "@/lib/messaging";
import { enqueueOutboxSend } from "@/lib/queue/outbox";
import { SendRejectedError, sendTextMessage } from "@/lib/messaging/send";
import { logError } from "@/lib/log/safe-error";

export type LinksPagoDelChat = { links: LinkPago[]; textos: TextosLink; bloqueo: string | null };

const idSchema = z.string().min(1).max(128);

async function chatDeLaOrg(organizationId: string, conversationId: string) {
  const [conv] = await db
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  return conv ?? null;
}

export async function listLinksPagoDelChat(conversationId: string): Promise<LinksPagoDelChat> {
  const { organizationId } = await requireActiveMembership();
  const id = idSchema.parse(conversationId);
  if (!(await chatDeLaOrg(organizationId, id))) return { links: [], textos: await loadTextosLink(organizationId), bloqueo: null };
  const [links, textos, pais] = await Promise.all([listLinksPago(organizationId), loadTextosLink(organizationId), paisSinLinksDelChat(organizationId, id)]);
  return { links, textos, bloqueo: pais ? `Este número es de ${pais}, fuera de México: no se le mandan links de pago.` : null };
}

export type SendLinkPagoResult = { ok: true; sent: number } | { ok: false; message: string };

export async function sendLinkPago(conversationId: string, linkId: string): Promise<SendLinkPagoResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const convId = idSchema.parse(conversationId);
  const id = idSchema.parse(linkId);
  const conv = await chatDeLaOrg(organizationId, convId);
  if (!conv) return { ok: false, message: "No se encontró el chat." };
  const pais = await paisSinLinksDelChat(organizationId, convId);
  if (pais) return { ok: false, message: `Este número es de ${pais}, fuera de México: no se le mandan links de pago.` };
  const link = (await listLinksPago(organizationId)).find((l) => l.id === id);
  if (!link) return { ok: false, message: "Ese link ya no está en la lista; vuelve a abrir Links de pago." };
  const mensajes = mensajesLink(link, await loadTextosLink(organizationId));
  let sent = 0;
  try {
    // En orden y uno por uno: el 2.º (datos de envío) solo sale si el del link salió.
    for (const text of mensajes) {
      await sendTextMessage(messagingProvider(), { organizationId, conversationId: convId, sentByUserId: userId, text, deferTo: enqueueOutboxSend, humanAgent: true });
      sent++;
    }
  } catch (error) {
    if (sent > 0) await pauseAgentForManualSend(organizationId, convId).catch(() => undefined);
    if (error instanceof SendRejectedError) return { ok: false, message: error.message };
    logError("[links-pago] no se pudo mandar el link de pago", error);
    return { ok: false, message: sent > 0 ? "Salió el link pero no el mensaje de los datos de envío; mándalo a mano." : "No se pudo mandar el link; inténtalo de nuevo." };
  }
  // Un mensaje manual del vendedor pausa al Agente IA en esta conversación (como sendMessage).
  await pauseAgentForManualSend(organizationId, convId);
  // Como /banco: recibir el link deja al contacto en "Cerca de compra" (solo hacia adelante).
  try {
    const stages = await listFunnelStages(organizationId);
    const to = roleKey(stages, "cerca_compra");
    if (to) await moveStageForward({ organizationId, contactId: conv.contactId, to, by: "sistema", now: new Date(), stages, fireStageTriggers: false, actorUserId: userId });
  } catch (error) {
    logError("[links-pago] no se pudo mover a Cerca de compra tras el link", error);
  }
  return { ok: true, sent };
}
