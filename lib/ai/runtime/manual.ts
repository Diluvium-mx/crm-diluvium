// Acción manual sobre el agente en una conversación (Bandeja y Detalle del
// contacto): "Reactivar" tras una pausa (un vendedor contestó o apagó el bot con
// "Apagar bot", ver pause.ts). Filtra SIEMPRE por organización. La usan las
// Server Actions de lib/actions/agente-conversacion.ts.
import { desc, and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, conversations } from "@/lib/db/schema";
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
