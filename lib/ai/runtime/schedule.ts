// Cuánto esperar antes de responder una conversación (debounce deslizante de 15 s de
// fábrica —5 a 60 s desde Opciones del bot— con tope de 60 s), calculado desde la BD:
// el primer y el último entrante pendientes POSTERIORES al último corte (ver
// debounceWindow). Fuera del horario del bot no se programa nada.
import { isWithinSchedule } from "@/lib/agente-ia/opciones";
import { lastHandledInboundAt, loadSnapshot, pendingInbound, type ChannelRow, type ConversationRow, type MessageRow } from "./context";
import { loadBotOptions } from "./options";
import { anticipar, debounceDelayMs, debounceWindow, fireAtMs, rescheduleDelayMs } from "./policy";

// Ventana del debounce para estos pendientes (null si no hay ninguno).
export async function pendingWindow(
  snap: { conversation: ConversationRow; channel: ChannelRow },
  pending: readonly MessageRow[],
): Promise<{ firstPendingAt: number; lastInboundAt: number } | null> {
  if (pending.length === 0) return null;
  const handled = await lastHandledInboundAt(snap.conversation.organizationId, snap.conversation.id);
  // Hora de LLEGADA (created_at): el debounce mide cuánto lleva esperando el CRM.
  return debounceWindow(
    pending.map((m) => m.createdAt.getTime()),
    [
      handled?.getTime() ?? null,
      snap.conversation.agentStateChangedAt?.getTime() ?? null,
      snap.channel.aiAgentModeChangedAt?.getTime() ?? null,
    ],
  );
}

// null = no hay nada que programar (canal apagado o sin pendientes).
export async function debounceDelayFor(organizationId: string, conversationId: string, now: Date): Promise<number | null> {
  const snap = await loadSnapshot(organizationId, conversationId);
  if (!snap || snap.channel.aiAgentMode !== "auto" || snap.sinAgenteIa) return null;
  // Agente pausado (un vendedor contestó): no hay nada que programar hasta "Reactivar".
  if (snap.conversation.agentState !== "activo") return null;
  const options = await loadBotOptions(organizationId, now);
  // Fuera del horario del bot: lo atiende el barrido al abrir (findPendingAtOpening).
  if (!isWithinSchedule(options.schedule, now)) return null;
  const win = await pendingWindow(snap, await pendingInbound(organizationId, conversationId));
  if (!win) return null;
  return debounceDelayMs({ now: now.getTime(), ...win }, options.responseDelaySeconds);
}

// Cuándo programar el JOB: ANTICIPO_MS antes de que se cumpla la espera (la respuesta se prepara mientras tanto y
// sale a la hora de siempre: run.ts › holdUntil).
export async function jobDelayFor(organizationId: string, conversationId: string, now: Date): Promise<number | null> {
  const delay = await debounceDelayFor(organizationId, conversationId, now);
  return delay === null ? null : anticipar(delay);
}

// Hora desde la que la respuesta a estos pendientes puede salir (null sin pendientes).
export async function fireAtFor(
  snap: { conversation: ConversationRow; channel: ChannelRow },
  pending: readonly MessageRow[],
  delaySeconds: number,
): Promise<Date | null> {
  const win = await pendingWindow(snap, pending);
  return win ? new Date(fireAtMs(win, delaySeconds)) : null;
}

// Tras descartar una respuesta (el cliente siguió escribiendo): de vuelta al debounce, nunca en 0 (el job, con su
// anticipo; la respuesta sale a la hora de siempre).
export async function rescheduleDelayFor(organizationId: string, conversationId: string, now: Date): Promise<number> {
  const snap = await loadSnapshot(organizationId, conversationId);
  if (!snap) return 0;
  const win = await pendingWindow(snap, await pendingInbound(organizationId, conversationId));
  if (!win) return 0;
  return anticipar(rescheduleDelayMs({ now: now.getTime(), ...win }, (await loadBotOptions(organizationId, now)).responseDelaySeconds));
}
