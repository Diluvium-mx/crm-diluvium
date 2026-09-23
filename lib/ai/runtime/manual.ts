// Acciones manuales sobre el agente en una conversación (desde la bandeja y el
// Detalle del contacto): reactivarlo tras una pausa o pausarlo a mano. Filtran
// SIEMPRE por organización. Las usan las Server Actions de
// lib/actions/agente-conversacion.ts. (Desde el 23-sep-2026 no hay borradores.)
import { desc, and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, conversations } from "@/lib/db/schema";
import { bullAgentQueuePort, cancelAgentRun, withQueueTimeout } from "./queue";
import { loadNotices } from "./notices";

// Vuelve a activar el agente. El corte (agent_state_changed_at = ahora) hace
// que lo que un vendedor respondió ANTES ya no lo vuelva a pausar. No responde
// solo: espera al siguiente mensaje del cliente. Devuelve si cambió algo.
export async function reactivateAgentInConversation(
  organizationId: string,
  conversationId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: now })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
        ne(conversations.agentState, "activo"),
      ),
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
}

// Pausa manual desde el interruptor del contacto (un vendedor apaga al agente
// en esa conversación): pausado_humano, reactivación manual. Cancela el job
// pendiente si lo hay (sin Redis, el candado y la compuerta lo frenan igual).
export async function pauseAgentInConversation(
  organizationId: string,
  conversationId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ agentState: "pausado_humano", agentPausedUntil: null, agentStateChangedAt: now })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
        eq(conversations.agentState, "activo"),
      ),
    )
    .returning({ id: conversations.id });
  if (rows.length > 0) {
    await withQueueTimeout(cancelAgentRun(bullAgentQueuePort(), conversationId), "cancelar").catch((error) =>
      console.error(`[agente] no se pudo cancelar el job de ${conversationId}: ${String(error)}`),
    );
  }
  return rows.length > 0;
}

// ── Lecturas para la UI (siempre por organización) ──────────────────────────
export async function loadConversationAgent(organizationId: string, conversationId: string) {
  const [row] = await db
    .select({ conversation: conversations, channel: channels })
    .from(conversations)
    .innerJoin(channels, and(eq(channels.id, conversations.channelId), eq(channels.organizationId, organizationId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return {
    channelMode: row.channel.aiAgentMode,
    agentState: row.conversation.agentState,
    pausedUntil: row.conversation.agentPausedUntil,
    notices: await loadNotices(organizationId, conversationId),
  };
}

export async function loadContactAgents(organizationId: string, contactId: string) {
  return db
    .select({
      conversationId: conversations.id,
      channelName: channels.displayName,
      channelMode: channels.aiAgentMode,
      agentState: conversations.agentState,
      pausedUntil: conversations.agentPausedUntil,
    })
    .from(conversations)
    .innerJoin(channels, and(eq(channels.id, conversations.channelId), eq(channels.organizationId, organizationId)))
    .where(and(eq(conversations.contactId, contactId), eq(conversations.organizationId, organizationId)))
    .orderBy(desc(conversations.lastMessageAt));
}
