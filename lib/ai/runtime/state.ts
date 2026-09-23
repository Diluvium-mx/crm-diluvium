// Escrituras de estado del runtime del agente: transiciones de agent_state,
// marca de respuesta y planes de envío. La única pausa (un vendedor contestó)
// queda en agent_state, visible en la bandeja; lo demás deja un aviso (notices.ts).
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, conversations } from "@/lib/db/schema";
import type { AgentState } from "./policy";

// Multi-tenant (CLAUDE.md §7): toda escritura filtra por organization_id además
// del id; un id de otra organización no cambia nada.
const ownConversation = (organizationId: string, conversationId: string) =>
  and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId));

// Cambia el estado del agente en la conversación. `agent_state_changed_at` es
// el corte de "respuesta humana": lo anterior a una reactivación ya no pausa.
export async function setAgentState(
  organizationId: string,
  conversationId: string,
  state: AgentState,
  opts: { now: Date; pausedUntil?: Date | null },
): Promise<void> {
  await db
    .update(conversations)
    .set({ agentState: state, agentPausedUntil: opts.pausedUntil ?? null, agentStateChangedAt: opts.now })
    .where(ownConversation(organizationId, conversationId));
}

export async function markAgentReply(organizationId: string, conversationId: string, at: Date): Promise<void> {
  await db.update(conversations).set({ lastAgentReplyAt: at }).where(ownConversation(organizationId, conversationId));
}

type Executor = Pick<typeof db, "execute">;

// Avisa a la bandeja (SSE) que algo del agente cambió en la conversación. Los
// cambios en `conversations` ya avisan por el trigger de la 0008; los avisos
// viven en su propia tabla, así que se avisa a mano con el MISMO canal y forma
// ("conversation.updated"). Dentro de una transacción, sale al hacer COMMIT.
export async function notifyConversation(exec: Executor, organizationId: string, conversationId: string): Promise<void> {
  await exec.execute(
    sql`select pg_notify('inbox_events', json_build_object('org', ${organizationId}::text, 'type', 'conversation.updated', 'conversationId', ${conversationId}::text)::text)`,
  );
}

// Guarda el PLAN durable de una respuesta AUTO de varias burbujas ("enviando",
// invisible en la bandeja) ANTES de mandar la 1ª: si el worker se reinicia a la
// mitad, el barrido (reconcileStuckDrafts) lo concilia con el hilo. resolved_at
// sale del reloj de Postgres, el mismo de messages.created_at.
export async function savePlan(input: {
  organizationId: string;
  conversationId: string;
  bubbles: string[];
  triggerMessageId: string | null;
  now: Date;
}): Promise<string> {
  const id = crypto.randomUUID();
  // La FK solo exige que la conversación exista: se exige además que sea de esta organización.
  const [own] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(ownConversation(input.organizationId, input.conversationId))
    .limit(1);
  if (!own) throw new Error(`conversación ${input.conversationId} no pertenece a la organización`);
  await db.insert(aiAgentDrafts).values({
    id,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    bubbles: input.bubbles,
    triggerMessageId: input.triggerMessageId,
    status: "enviando",
    resolvedAt: sql`now()`,
    createdAt: input.now,
  });
  return id;
}

// Cierra el PLAN de un envío AUTO ("enviando") como enviado u obsoleto.
export async function closePlan(organizationId: string, planId: string, status: "enviado" | "obsoleto"): Promise<void> {
  await db
    .update(aiAgentDrafts)
    .set({ status })
    .where(and(eq(aiAgentDrafts.id, planId), eq(aiAgentDrafts.organizationId, organizationId), eq(aiAgentDrafts.status, "enviando")));
}
