// Escrituras de estado del runtime del agente: transiciones de agent_state,
// etiquetas de rastro en el contacto, marca de respuesta y borradores.
// "Nunca callarse sin dejar rastro": toda pausa queda en agent_state (visible en
// la bandeja) y, cuando aplica, como etiqueta del contacto.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, contacts, conversations } from "@/lib/db/schema";
import type { AgentState } from "./policy";

export { TAG_ANTI_LOOP, TAG_HANDOVER } from "./tags";

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

// Agrega una etiqueta al contacto si no la tiene (idempotente).
export async function addContactTag(organizationId: string, contactId: string, tag: string): Promise<void> {
  await db
    .update(contacts)
    .set({ tags: sql`case when ${tag} = any(${contacts.tags}) then ${contacts.tags} else array_append(${contacts.tags}, ${tag}) end` })
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
}

export async function markAgentReply(organizationId: string, conversationId: string, at: Date): Promise<void> {
  await db.update(conversations).set({ lastAgentReplyAt: at }).where(ownConversation(organizationId, conversationId));
}

type Executor = Pick<typeof db, "execute">;

// Avisa a la bandeja (SSE) que algo del agente cambió en la conversación. Los
// cambios en `conversations` ya avisan por el trigger de la 0008; los borradores
// viven en su propia tabla, así que se avisa a mano con el MISMO canal y forma
// ("conversation.updated"). Dentro de una transacción, sale al hacer COMMIT.
export async function notifyConversation(exec: Executor, organizationId: string, conversationId: string): Promise<void> {
  await exec.execute(
    sql`select pg_notify('inbox_events', json_build_object('org', ${organizationId}::text, 'type', 'conversation.updated', 'conversationId', ${conversationId}::text)::text)`,
  );
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
    // La FK solo exige que la conversación exista: se exige además que sea de esta organización.
    const [own] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(ownConversation(input.organizationId, input.conversationId))
      .limit(1);
    if (!own) throw new Error(`conversación ${input.conversationId} no pertenece a la organización`);
    await tx
      .update(aiAgentDrafts)
      .set({ status: "obsoleto", resolvedAt: input.now })
      .where(
        and(
          eq(aiAgentDrafts.organizationId, input.organizationId),
          eq(aiAgentDrafts.conversationId, input.conversationId),
          eq(aiAgentDrafts.status, "pendiente"),
        ),
      );
    await tx.insert(aiAgentDrafts).values({
      id,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      bubbles: input.bubbles,
      triggerMessageId: input.triggerMessageId,
      status: "pendiente",
      createdAt: input.now,
    });
    await notifyConversation(tx, input.organizationId, input.conversationId);
  });
  return id;
}

// Un vendedor ya respondió: el borrador vigente de esa conversación quedó viejo.
export async function obsoletePendingDrafts(organizationId: string, conversationId: string, now: Date): Promise<number> {
  const rows = await db
    .update(aiAgentDrafts)
    .set({ status: "obsoleto", resolvedAt: now })
    .where(
      and(
        eq(aiAgentDrafts.conversationId, conversationId),
        eq(aiAgentDrafts.organizationId, organizationId),
        eq(aiAgentDrafts.status, "pendiente"),
      ),
    )
    .returning({ id: aiAgentDrafts.id });
  if (rows.length > 0) await notifyConversation(db, organizationId, conversationId);
  return rows.length;
}

// El canal se apagó: sus borradores vigentes quedan viejos (nada del agente sale
// por un canal apagado). Avisa a la bandeja de cada conversación afectada.
export async function obsoleteChannelDrafts(organizationId: string, channelId: string, now: Date): Promise<number> {
  const rows = await db
    .update(aiAgentDrafts)
    .set({ status: "obsoleto", resolvedAt: now })
    .where(
      and(
        eq(aiAgentDrafts.organizationId, organizationId),
        eq(aiAgentDrafts.status, "pendiente"),
        inArray(
          aiAgentDrafts.conversationId,
          db
            .select({ id: conversations.id })
            .from(conversations)
            .where(and(eq(conversations.channelId, channelId), eq(conversations.organizationId, organizationId))),
        ),
      ),
    )
    .returning({ conversationId: aiAgentDrafts.conversationId });
  for (const r of rows) await notifyConversation(db, organizationId, r.conversationId);
  return rows.length;
}
