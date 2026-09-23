// Cuánto esperar antes de responder una conversación (debounce deslizante con
// tope), calculado desde la BD: el primer y el último entrante pendientes
// POSTERIORES al último corte (ver debounceWindow).
import { loadAgentConfig } from "./config";
import { lastHandledInboundAt, loadSnapshot, pendingInbound, type ChannelRow, type ConversationRow, type MessageRow } from "./context";
import { debounceDelayMs, debounceWindow, rescheduleDelayMs } from "./policy";

// Ventana del debounce para estos pendientes (null si no hay ninguno).
export async function pendingWindow(
  snap: { conversation: ConversationRow; channel: ChannelRow },
  pending: readonly MessageRow[],
): Promise<{ firstPendingAt: number; lastInboundAt: number } | null> {
  if (pending.length === 0) return null;
  const handled = await lastHandledInboundAt(snap.conversation.id);
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
export async function debounceDelayFor(conversationId: string, now: Date): Promise<number | null> {
  const snap = await loadSnapshot(conversationId);
  if (!snap || snap.channel.aiAgentMode === "off") return null;
  const win = await pendingWindow(snap, await pendingInbound(conversationId));
  if (!win) return null;
  const cfg = await loadAgentConfig(snap.conversation.organizationId);
  return debounceDelayMs({
    now: now.getTime(),
    ...win,
    responseDelaySeconds: cfg.responseDelaySeconds,
    maxWaitSeconds: cfg.maxWaitSeconds,
  });
}

// Tras descartar respuestas en todas las rondas: de vuelta al debounce, nunca en 0.
export async function rescheduleDelayFor(conversationId: string, now: Date): Promise<number> {
  const snap = await loadSnapshot(conversationId);
  if (!snap) return 0;
  const win = await pendingWindow(snap, await pendingInbound(conversationId));
  if (!win) return 0;
  const cfg = await loadAgentConfig(snap.conversation.organizationId);
  return rescheduleDelayMs({
    now: now.getTime(),
    ...win,
    responseDelaySeconds: cfg.responseDelaySeconds,
    maxWaitSeconds: cfg.maxWaitSeconds,
  });
}
