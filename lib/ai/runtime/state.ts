// Escrituras de estado del runtime del agente: transiciones de agent_state,
// etiquetas de rastro en el contacto, marca de respuesta y borradores.
// "Nunca callarse sin dejar rastro": toda pausa queda en agent_state (visible en
// la bandeja) y, cuando aplica, como etiqueta del contacto.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, contacts, conversations } from "@/lib/db/schema";
import type { AgentState } from "./policy";

export { TAG_ANTI_LOOP, TAG_HANDOVER } from "./tags";

// Cambia el estado del agente en la conversación. `agent_state_changed_at` es
// el corte de "respuesta humana": lo anterior a una reactivación ya no pausa.
export async function setAgentState(
  conversationId: string,
  state: AgentState,
  opts: { now: Date; pausedUntil?: Date | null },
): Promise<void> {
  await db
    .update(conversations)
    .set({ agentState: state, agentPausedUntil: opts.pausedUntil ?? null, agentStateChangedAt: opts.now })
    .where(eq(conversations.id, conversationId));
}

// Agrega una etiqueta al contacto si no la tiene (idempotente).
export async function addContactTag(contactId: string, tag: string): Promise<void> {
  await db
    .update(contacts)
    .set({ tags: sql`case when ${tag} = any(${contacts.tags}) then ${contacts.tags} else array_append(${contacts.tags}, ${tag}) end` })
    .where(eq(contacts.id, contactId));
}

export async function markAgentReply(conversationId: string, at: Date): Promise<void> {
  await db.update(conversations).set({ lastAgentReplyAt: at }).where(eq(conversations.id, conversationId));
}

// Guarda el borrador del modo "borrador". Uno solo vigente por conversación: el
// anterior "pendiente" pasa a "obsoleto" en la misma transacción.
export async function saveDraft(input: {
  organizationId: string;
  conversationId: string;
  bubbles: string[];
  triggerMessageId: string | null;
  now: Date;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .update(aiAgentDrafts)
      .set({ status: "obsoleto", resolvedAt: input.now })
      .where(and(eq(aiAgentDrafts.conversationId, input.conversationId), eq(aiAgentDrafts.status, "pendiente")));
    await tx.insert(aiAgentDrafts).values({
      id,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      bubbles: input.bubbles,
      triggerMessageId: input.triggerMessageId,
      status: "pendiente",
      createdAt: input.now,
    });
  });
  return id;
}
