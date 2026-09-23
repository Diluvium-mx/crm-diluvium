// Acciones manuales sobre el agente en una conversación (desde la bandeja):
// reactivarlo tras una pausa y enviar/descartar el borrador del modo "borrador".
// Filtran SIEMPRE por organización. Las usan las Server Actions de
// lib/actions/agente-conversacion.ts (la UI de la bandeja llega al final).
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, conversations } from "@/lib/db/schema";
import { BUBBLE_PAUSE_MS } from "./run";
import { markAgentReply } from "./state";

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
      ),
    )
    .returning();
  if (!draft) throw new DraftNotAvailableError("Este borrador ya no está vigente (se envió, se descartó o hay uno más nuevo).");
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
        .where(eq(aiAgentDrafts.id, draft.id));
    }
    throw error;
  }
  await markAgentReply(draft.conversationId, input.now);
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
    .returning({ id: aiAgentDrafts.id });
  if (rows.length === 0) throw new DraftNotAvailableError("Este borrador ya no está vigente.");
}
