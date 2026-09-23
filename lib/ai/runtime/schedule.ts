// Cuánto esperar antes de responder una conversación (debounce deslizante con
// tope), calculado desde la BD: el primer y el último entrante pendientes.
import { loadAgentConfig } from "./config";
import { loadSnapshot, pendingInbound } from "./context";
import { debounceDelayMs } from "./policy";

// null = no hay nada que programar (canal apagado o sin pendientes).
export async function debounceDelayFor(conversationId: string, now: Date): Promise<number | null> {
  const snap = await loadSnapshot(conversationId);
  if (!snap || snap.channel.aiAgentMode === "off") return null;
  const pending = await pendingInbound(conversationId);
  if (pending.length === 0) return null;
  const cfg = await loadAgentConfig(snap.conversation.organizationId);
  // Hora de LLEGADA (created_at): el debounce mide cuánto lleva esperando el CRM.
  const arrivals = pending.map((m) => m.createdAt.getTime());
  return debounceDelayMs({
    now: now.getTime(),
    firstPendingAt: Math.min(...arrivals),
    lastInboundAt: Math.max(...arrivals),
    responseDelaySeconds: cfg.responseDelaySeconds,
    maxWaitSeconds: cfg.maxWaitSeconds,
  });
}
