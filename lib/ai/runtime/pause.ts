// "Apagar bot" por conversación (25-sep-2026): el vendedor apaga al agente en UNA
// conversación por 8/12/24 h, hasta una hora exacta o hasta reactivarlo. Es la
// misma pausa que deja un vendedor al contestar (pausado_humano); lo que cambia es
// la hora de regreso (agent_paused_until; null = hasta "Reactivar"). Al vencer,
// el barrido del worker (cada minuto) lo vuelve a "activo". Toda escritura filtra
// por organización.
//
// Regla del dueño — solo mensajes nuevos: al reactivarse, el corte
// (agent_state_changed_at = ahora) deja atrás lo que el cliente escribió durante la
// pausa: nada lo contesta solo (ni el barrido de huérfanos tras un reinicio); el
// agente responde a partir del siguiente mensaje del cliente.
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { bullAgentQueuePort, cancelAgentRun, withQueueTimeout, type AgentQueuePort } from "./queue";

const ownConversation = (organizationId: string, conversationId: string) =>
  and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId));

// Pausa con hora de regreso ya cumplida (la de "sin tiempo" nunca vence).
const pauseDue = (now: Date) =>
  and(eq(conversations.agentState, "pausado_humano"), isNotNull(conversations.agentPausedUntil), lte(conversations.agentPausedUntil, now));

/** ¿El bot ya debió volver? (pausa con hora cumplida que el barrido aún no reactivó). */
export function isPauseDue(c: { agentState: string; agentPausedUntil: Date | null }, now: Date): boolean {
  return c.agentState === "pausado_humano" && c.agentPausedUntil !== null && c.agentPausedUntil.getTime() <= now.getTime();
}

// Apaga el bot en la conversación hasta `until` (null = hasta "Reactivar"). Si ya
// estaba apagado, cambia la hora de regreso. Cancela el job pendiente: un mensaje
// que llegó justo antes no debe contestarse cuando el bot vuelva. Devuelve false si
// la conversación no es de la organización.
export async function pauseAgentManually(
  input: { organizationId: string; conversationId: string; until: Date | null; now: Date },
  ports: { queue?: AgentQueuePort } = {},
): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ agentState: "pausado_humano", agentPausedUntil: input.until, agentStateChangedAt: input.now })
    .where(ownConversation(input.organizationId, input.conversationId))
    .returning({ id: conversations.id });
  if (rows.length === 0) return false;
  // La pausa ya quedó guardada: cancelar el job es solo optimización (la corrida
  // revisa el estado antes de responder y antes de cada burbuja).
  await withQueueTimeout(cancelAgentRun(ports.queue ?? bullAgentQueuePort(), input.conversationId), "cancelar").catch(
    (error) => console.error(`[agente] no se pudo cancelar el job de ${input.conversationId}: ${String(error)}`),
  );
  return true;
}

// Vuelve a "activo" una pausa con hora cumplida. Condicional: si otro vendedor la
// cambió o la reactivó en medio, no se pisa. Devuelve si cambió algo.
export async function reactivateDuePause(organizationId: string, conversationId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: now })
    .where(and(ownConversation(organizationId, conversationId), pauseDue(now)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

// Barrido del worker (cada minuto): mantenimiento de sistema sobre todas las
// organizaciones, pero cada escritura va acotada a la organización de su fila. La
// Bandeja se entera por el SSE (trigger de `conversations`, 0008).
export async function reactivateDuePauses(now: Date, limit = 200): Promise<number> {
  const due = await db
    .select({ id: conversations.id, organizationId: conversations.organizationId })
    .from(conversations)
    .where(pauseDue(now))
    .limit(limit);
  let reactivated = 0;
  for (const c of due) if (await reactivateDuePause(c.organizationId, c.id, now)) reactivated++;
  return reactivated;
}
