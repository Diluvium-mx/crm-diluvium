// Acciones manuales sobre el agente en una conversación (desde la bandeja):
// reactivarlo tras una pausa y enviar/descartar el borrador del modo "borrador".
// Filtran SIEMPRE por organización. Las usan las Server Actions de
// lib/actions/agente-conversacion.ts (la UI de la bandeja llega al final).
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, channels, conversations } from "@/lib/db/schema";
import { bullAgentQueuePort, cancelAgentRun, withQueueTimeout } from "./queue";
import { BUBBLE_PAUSE_MS } from "./run";
import { markAgentReply, notifyConversation } from "./state";

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

export class DraftNotAvailableError extends Error {}

type SendBubble = (p: { organizationId: string; conversationId: string; text: string; sentByUserId: string }) => Promise<void>;

// Envía un borrador. Lo RECLAMA primero (pendiente → enviado) en una sola
// sentencia: dos clics o dos vendedores no lo mandan dos veces. Si la primera
// burbuja falla, vuelve a "pendiente" para poder reintentar.
export async function approveDraft(input: {
  organizationId: string;
  draftId: string;
  userId: string;
  now: Date;
  sendBubble: SendBubble;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ sent: number }> {
  const [draft] = await db
    .update(aiAgentDrafts)
    .set({ status: "enviado", resolvedAt: input.now, resolvedByUserId: input.userId })
    .where(
      and(
        eq(aiAgentDrafts.id, input.draftId),
        eq(aiAgentDrafts.organizationId, input.organizationId),
        eq(aiAgentDrafts.status, "pendiente"),
        // Con el agente apagado en el canal, el borrador ya no sale.
        sql`exists (select 1 from ${conversations} c join ${channels} ch on ch.id = c.channel_id
          where c.id = ${aiAgentDrafts.conversationId} and c.organization_id = ${input.organizationId}
            and ch.organization_id = ${input.organizationId} and ch.ai_agent_mode <> 'off')`,
      ),
    )
    .returning();
  if (!draft) throw new DraftNotAvailableError("Este borrador ya no está vigente (se envió, se descartó, hay uno más nuevo o el agente está apagado).");
  await notifyConversation(db, input.organizationId, draft.conversationId);
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let sent = 0;
  try {
    for (const text of draft.bubbles) {
      if (sent > 0) await sleep(BUBBLE_PAUSE_MS);
      await input.sendBubble({ organizationId: input.organizationId, conversationId: draft.conversationId, text, sentByUserId: input.userId });
      sent++;
    }
  } catch (error) {
    if (sent === 0) {
      await db
        .update(aiAgentDrafts)
        .set({ status: "pendiente", resolvedAt: null, resolvedByUserId: null })
        .where(and(eq(aiAgentDrafts.id, draft.id), eq(aiAgentDrafts.organizationId, input.organizationId)));
      await notifyConversation(db, input.organizationId, draft.conversationId);
    }
    throw error;
  }
  await markAgentReply(input.organizationId, draft.conversationId, input.now);
  return { sent };
}

export async function discardDraft(input: { organizationId: string; draftId: string; userId: string; now: Date }): Promise<void> {
  const rows = await db
    .update(aiAgentDrafts)
    .set({ status: "descartado", resolvedAt: input.now, resolvedByUserId: input.userId })
    .where(
      and(
        eq(aiAgentDrafts.id, input.draftId),
        eq(aiAgentDrafts.organizationId, input.organizationId),
        eq(aiAgentDrafts.status, "pendiente"),
      ),
    )
    .returning({ id: aiAgentDrafts.id, conversationId: aiAgentDrafts.conversationId });
  if (rows.length === 0) throw new DraftNotAvailableError("Este borrador ya no está vigente.");
  await notifyConversation(db, input.organizationId, rows[0].conversationId);
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
  const [draft] = await db
    .select()
    .from(aiAgentDrafts)
    .where(
      and(
        eq(aiAgentDrafts.conversationId, conversationId),
        eq(aiAgentDrafts.organizationId, organizationId),
        eq(aiAgentDrafts.status, "pendiente"),
      ),
    )
    .orderBy(desc(aiAgentDrafts.createdAt))
    .limit(1);
  return {
    channelMode: row.channel.aiAgentMode,
    agentState: row.conversation.agentState,
    pausedUntil: row.conversation.agentPausedUntil,
    draft: draft ? { id: draft.id, bubbles: draft.bubbles, createdAt: draft.createdAt, reviewReason: draft.reviewReason } : null,
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
