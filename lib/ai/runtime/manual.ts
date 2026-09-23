// Acciones manuales sobre el agente en una conversación (desde la bandeja):
// reactivarlo tras una pausa y enviar/descartar el borrador del modo "borrador".
// Filtran SIEMPRE por organización. Las usan las Server Actions de
// lib/actions/agente-conversacion.ts (la UI de la bandeja llega al final).
import { and, desc, eq, ne, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, channels, conversations } from "@/lib/db/schema";
import { bullAgentQueuePort, cancelAgentRun, withQueueTimeout } from "./queue";
import { BUBBLE_PAUSE_MS } from "./run";
import { humanOutboundCount, inboundCount } from "./context";
import { markAgentReply, notifyConversation, retainRemainder } from "./state";

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

// Devuelve el resultado del proveedor: "pending" = resultado desconocido (timeout, 5xx):
// el mensaje queda en el outbox y se concilia solo; el borrador NO se da por enviado.
type SendBubble = (p: {
  organizationId: string;
  conversationId: string;
  text: string;
  sentByUserId: string;
}) => Promise<{ status: "sent" | "pending" }>;

// Envía un borrador. Lo RECLAMA primero (pendiente → enviando) en una sola
// sentencia: dos clics o dos vendedores no lo mandan dos veces. Queda "enviado"
// solo DESPUÉS de mandar sus burbujas; si el proceso muere a la mitad, el barrido
// lo concilia con el hilo (reconcileStuckDrafts). Antes de cada burbuja revisa que
// el agente siga encendido en el canal. Si la primera falla, vuelve a "pendiente".
export async function approveDraft(input: {
  organizationId: string;
  draftId: string;
  userId: string;
  now: Date;
  sendBubble: SendBubble;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ sent: number; confirmed: boolean }> {
  const org = input.organizationId;
  // Líneas base ANTES de reclamar: si el cliente escribe o un vendedor responde en
  // cualquier momento desde aquí (incluido el reclamo), el resto ya no contesta lo
  // último y queda en la tarjeta. Se revisan antes de CADA burbuja, también la 1ª.
  const [target] = await db
    .select({ conversationId: aiAgentDrafts.conversationId })
    .from(aiAgentDrafts)
    .where(and(eq(aiAgentDrafts.id, input.draftId), eq(aiAgentDrafts.organizationId, org)))
    .limit(1);
  const inboundsAtClaim = target ? await inboundCount(org, target.conversationId) : 0;
  const humansAtClaim = target ? await humanOutboundCount(org, target.conversationId) : 0;
  // resolved_at con el reloj de Postgres (el mismo de messages.created_at): la
  // conciliación del barrido cuenta solo las burbujas guardadas DESDE el reclamo.
  const [draft] = await db
    .update(aiAgentDrafts)
    .set({ status: "enviando", resolvedAt: sql`now()`, resolvedByUserId: input.userId })
    .where(
      and(
        eq(aiAgentDrafts.id, input.draftId),
        eq(aiAgentDrafts.organizationId, org),
        eq(aiAgentDrafts.status, "pendiente"),
        // Con el agente apagado en el canal, el borrador ya no sale.
        channelOn(org, aiAgentDrafts.conversationId),
      ),
    )
    .returning();
  if (!draft) throw new DraftNotAvailableError("Este borrador ya no está vigente (se envió, se descartó, hay uno más nuevo o el agente está apagado).");
  const notify = () =>
    notifyConversation(db, org, draft.conversationId).catch((error: unknown) =>
      console.error(`[agente] no se pudo avisar a la bandeja (${draft.conversationId})`, error),
    );
  await notify();
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let sent = 0;
  let unconfirmed = false;
  let channelOff = false;
  let interrupted: string | null = null;
  try {
    for (const text of draft.bubbles) {
      if (sent > 0) await sleep(BUBBLE_PAUSE_MS);
      const [check] = await db.execute<{ ok: boolean }>(sql`select ${channelOn(org, draft.conversationId)} as ok`);
      if (!check?.ok) {
        channelOff = true;
        break;
      }
      if ((await inboundCount(org, draft.conversationId)) > inboundsAtClaim) {
        interrupted = "El cliente escribió mientras se enviaba";
        break;
      }
      if ((await humanOutboundCount(org, draft.conversationId)) > humansAtClaim) {
        interrupted = "Un vendedor respondió mientras se enviaba";
        break;
      }
      const outcome = await input.sendBubble({ organizationId: org, conversationId: draft.conversationId, text, sentByUserId: input.userId });
      sent++;
      // Sin confirmación no se manda la siguiente (igual que en AUTO).
      if (outcome.status !== "sent") {
        unconfirmed = true;
        break;
      }
    }
  } catch (error) {
    if (sent === 0) await releaseDraft(org, draft.id, draft.conversationId);
    else {
      // Salió una parte: lo que faltó vuelve a la tarjeta con el motivo (nunca se pierde).
      await markAgentReply(org, draft.conversationId, input.now);
      await retainRemainder(
        org,
        draft.id,
        draft.conversationId,
        draft.bubbles.slice(sent),
        `Se enviaron ${sent} de ${draft.bubbles.length} burbujas y la siguiente falló; revisa el hilo antes de mandar el resto.`,
      );
    }
    await notify();
    throw error;
  }
  if (interrupted) {
    if (sent === 0) await releaseDraft(org, draft.id, draft.conversationId);
    else {
      await markAgentReply(org, draft.conversationId, input.now);
      await retainRemainder(
        org,
        draft.id,
        draft.conversationId,
        draft.bubbles.slice(sent),
        `${interrupted}: salieron ${sent} de ${draft.bubbles.length} burbujas; revisa el hilo antes de mandar el resto.`,
      );
    }
    await notify();
    return { sent, confirmed: !unconfirmed };
  }
  if (sent === 0 && channelOff) {
    await finishDraft(org, draft.id, "obsoleto", input.now, draft.conversationId);
    await notify();
    throw new DraftNotAvailableError("El agente se apagó en este canal: el borrador ya no se envía.");
  }
  // "enviado" solo si WhatsApp confirmó todas las burbujas. Si una quedó "pending":
  // con resto, el resto vuelve a la tarjeta con el motivo; sin resto, el borrador
  // sigue "enviando" y el barrido lo resuelve con el estado real (nunca reenvía).
  if (!unconfirmed) await finishDraft(org, draft.id, "enviado", input.now, draft.conversationId);
  else if (sent < draft.bubbles.length) {
    await markAgentReply(org, draft.conversationId, input.now);
    await retainRemainder(
      org,
      draft.id,
      draft.conversationId,
      draft.bubbles.slice(sent),
      "WhatsApp no confirmó la burbuja anterior; revisa el hilo antes de mandar el resto.",
    );
  }
  await notify();
  return { sent, confirmed: !unconfirmed };
}

// El canal de la conversación tiene el agente encendido (y todo es de la organización).
function channelOn(organizationId: string, conversationId: SQLWrapper | string) {
  return sql`exists (select 1 from ${conversations} c join ${channels} ch on ch.id = c.channel_id
    where c.id = ${conversationId} and c.organization_id = ${organizationId}
      and ch.organization_id = ${organizationId} and ch.ai_agent_mode <> 'off')`;
}

async function finishDraft(
  organizationId: string,
  draftId: string,
  status: "enviado" | "obsoleto",
  now: Date,
  conversationId: string,
): Promise<void> {
  await db
    .update(aiAgentDrafts)
    .set({ status })
    .where(and(eq(aiAgentDrafts.id, draftId), eq(aiAgentDrafts.organizationId, organizationId), eq(aiAgentDrafts.status, "enviando")));
  if (status === "enviado") await markAgentReply(organizationId, conversationId, now);
}

// Nada salió: vuelve a "pendiente" para reintentar, salvo que ya haya otro
// borrador pendiente en la conversación (índice único): entonces queda obsoleto.
export async function releaseDraft(organizationId: string, draftId: string, conversationId: string): Promise<void> {
  await db
    .update(aiAgentDrafts)
    .set({
      status: sql`case when exists (select 1 from ${aiAgentDrafts} d2 where d2.conversation_id = ${conversationId}
        and d2.status = 'pendiente') then 'obsoleto'::ai_draft_status else 'pendiente'::ai_draft_status end`,
      resolvedAt: null,
      resolvedByUserId: null,
    })
    .where(and(eq(aiAgentDrafts.id, draftId), eq(aiAgentDrafts.organizationId, organizationId), eq(aiAgentDrafts.status, "enviando")));
}

export async function discardDraft(input: { organizationId: string; draftId: string; userId: string; now: Date }): Promise<void> {
  const rows = await db
    .update(aiAgentDrafts)
    .set({ status: "descartado", resolvedAt: sql`now()`, resolvedByUserId: input.userId })
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
