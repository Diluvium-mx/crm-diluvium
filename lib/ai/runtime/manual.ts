// Acción manual sobre el agente en una conversación (Bandeja y Detalle del
// contacto): "Reactivar" tras una pausa (un vendedor contestó o apagó el bot con
// "Apagar bot", ver pause.ts). Filtra SIEMPRE por organización. La usan las
// Server Actions de lib/actions/agente-conversacion.ts.
import { desc, and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentNotices, channels, conversations } from "@/lib/db/schema";
import { agentStateLabel } from "@/lib/historial/labels";
import { chatSubject, logChanges } from "@/lib/historial/log";
import { loadNotices } from "./notices";

// Vuelve a activar el agente. El corte (agent_state_changed_at = ahora) hace
// que lo que un vendedor respondió ANTES ya no lo vuelva a pausar. No responde
// solo: espera al siguiente mensaje del cliente. Devuelve si cambió algo. Deja en el
// historial de cambios quién lo activó (Bloque A), en la misma transacción.
export async function reactivateAgentInConversation(
  organizationId: string,
  conversationId: string,
  now: Date,
  userId: string | null = null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const own = and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId));
    const [before] = await tx
      .select({ state: conversations.agentState, until: conversations.agentPausedUntil })
      .from(conversations)
      .where(own)
      .for("update");
    const rows = await tx
      .update(conversations)
      .set({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: now })
      .where(and(own, ne(conversations.agentState, "activo")))
      .returning({ id: conversations.id });
    if (before && rows.length > 0) {
      await logChanges(tx, {
        organizationId,
        userId,
        kind: "pausas",
        action: "activar",
        subject: chatSubject(organizationId, conversationId),
        subjectId: conversationId,
        oldValue: agentStateLabel(before.state, before.until),
        newValue: agentStateLabel("activo", null),
      });
    }
    // Opciones del bot: "Activar" atiende el aviso 🤖 "Llegó al máximo de respuestas" (la
    // tarjeta del Embudo deja de estar amarilla; ya lo revisó una persona).
    await tx
      .update(aiAgentNotices)
      .set({ resolvedAt: now, resolution: "activar" })
      .where(
        and(
          eq(aiAgentNotices.organizationId, organizationId),
          eq(aiAgentNotices.conversationId, conversationId),
          eq(aiAgentNotices.kind, "tope_respuestas"),
          isNull(aiAgentNotices.resolvedAt),
        ),
      );
    return rows.length > 0;
  });
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
