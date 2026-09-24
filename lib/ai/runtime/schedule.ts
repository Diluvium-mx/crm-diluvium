// Cuánto esperar antes de responder una conversación (debounce deslizante fijo de
// 15 s con tope de 60 s, como Ángela en GHL), calculado desde la BD: el primer y el último entrante pendientes
// POSTERIORES al último corte (ver debounceWindow).
import { lastHandledInboundAt, loadSnapshot, pendingInbound, type ChannelRow, type ConversationRow, type MessageRow } from "./context";
import { debounceDelayMs, debounceWindow, rescheduleDelayMs } from "./policy";

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
  if (!snap || snap.channel.aiAgentMode !== "auto") return null;
  // Agente pausado (un vendedor contestó): no hay nada que programar hasta "Reactivar".
  if (snap.conversation.agentState !== "activo") return null;
  const win = await pendingWindow(snap, await pendingInbound(organizationId, conversationId));
  if (!win) return null;
  return debounceDelayMs({ now: now.getTime(), ...win });
}

// Tras descartar respuestas en todas las rondas: de vuelta al debounce, nunca en 0.
export async function rescheduleDelayFor(organizationId: string, conversationId: string, now: Date): Promise<number> {
  const snap = await loadSnapshot(organizationId, conversationId);
  if (!snap) return 0;
  const win = await pendingWindow(snap, await pendingInbound(organizationId, conversationId));
  if (!win) return 0;
  return rescheduleDelayMs({ now: now.getTime(), ...win });
}
