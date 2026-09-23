// Barrido periódico del runtime del agente (cada minuto, en el worker):
// 1. Reactiva los "pasar a humano" cuyo plazo venció (handover_reactivate_hours),
//    aunque el cliente no haya vuelto a escribir (la bandeja deja de mostrarlos pausados).
// 2. Recoge conversaciones con un entrante sin atender y sin job (p. ej. Redis
//    no respondió al programar): la BD es la fuente de verdad; la cola solo acelera.
// Es mantenimiento de sistema (todas las organizaciones), como el barrido de webhooks.
import { and, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, conversations, messages } from "@/lib/db/schema";
import { releaseDraft } from "./manual";

// Un entrante con este número de errores del agente ya no se reintenta solo
// (los errores quedan en ai_usage como rastro).
export const MAX_ERRORS_PER_MESSAGE = 5;
const ORPHAN_MIN_AGE_SECONDS = 90;
// El barrido rescata fallas de la cola (Redis no respondió al programar), no
// contesta historia: un entrante de hace más de esto ya no se responde solo.
export const ORPHAN_MAX_AGE_MINUTES = 30;

export async function reactivateExpiredHandovers(now: Date): Promise<number> {
  const rows = await db
    .update(conversations)
    .set({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: now })
    .where(
      and(
        eq(conversations.agentState, "pausado_handover"),
        isNotNull(conversations.agentPausedUntil),
        lte(conversations.agentPausedUntil, now),
      ),
    )
    .returning({ id: conversations.id });
  return rows.length;
}

export type OrphanConversation = { conversationId: string; organizationId: string };

// Fechas como ISO con cast: en SQL crudo el driver no serializa Date, y así se
// comparan igual que las columnas timestamp que drizzle escribe (UTC).
const ts = (d: Date) => sql`${d.toISOString()}::timestamp`;

export async function findOrphanConversations(now: Date, limit = 50): Promise<OrphanConversation[]> {
  const since = new Date(now.getTime() - ORPHAN_MAX_AGE_MINUTES * 60_000);
  const rows = await db.execute<{ id: string; organization_id: string }>(sql`
    select c.id, c.organization_id
    from conversations c
    join channels ch on ch.id = c.channel_id
    join lateral (
      select m.id, m.direction, m.created_at
      from messages m
      where m.conversation_id = c.id and m.status <> 'failed'
      order by coalesce(m.sent_at, m.created_at) desc, m.created_at desc
      limit 1
    ) last on true
    where ch.ai_agent_mode <> 'off'
      and c.agent_state = 'activo'
      and c.window_expires_at > ${ts(now)}
      and c.last_message_at > ${ts(since)}
      and last.direction = 'in'
      and last.created_at < ${ts(new Date(now.getTime() - ORPHAN_MIN_AGE_SECONDS * 1000))}
      and last.created_at > ${ts(since)}
      -- Lo escrito ANTES de encender el canal o de reactivar al agente no se
      -- contesta solo: espera al siguiente mensaje del cliente.
      and last.created_at > coalesce(ch.ai_agent_mode_changed_at, '-infinity'::timestamp)
      and last.created_at > coalesce(c.agent_state_changed_at, '-infinity'::timestamp)
      and not exists (
        select 1 from ai_usage u
        where u.message_id = last.id and u.outcome in ('sent', 'draft', 'skipped', 'handover')
      )
      and not exists (select 1 from ai_agent_drafts d where d.trigger_message_id = last.id)
      and (select count(*) from ai_usage u where u.message_id = last.id and u.outcome = 'error') < ${MAX_ERRORS_PER_MESSAGE}
    limit ${limit}
  `);
  return rows.map((r) => ({ conversationId: r.id, organizationId: r.organization_id }));
}

// Un borrador aprobado cuyo envío quedó a la mitad (el proceso murió en "enviando")
// se concilia con el hilo: si ya hay un saliente del agente desde la aprobación,
// queda "enviado"; si no, vuelve a "pendiente" (o a obsoleto si ya hay otro).
export const DRAFT_SENDING_STUCK_MS = 10 * 60_000;

export async function reconcileStuckDrafts(now: Date): Promise<number> {
  const stuck = await db
    .select({
      id: aiAgentDrafts.id,
      organizationId: aiAgentDrafts.organizationId,
      conversationId: aiAgentDrafts.conversationId,
      resolvedAt: aiAgentDrafts.resolvedAt,
    })
    .from(aiAgentDrafts)
    .where(and(eq(aiAgentDrafts.status, "enviando"), lt(aiAgentDrafts.resolvedAt, new Date(now.getTime() - DRAFT_SENDING_STUCK_MS))))
    .limit(100);
  for (const d of stuck) {
    const since = new Date((d.resolvedAt ?? now).getTime() - 5_000);
    const [out] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, d.organizationId),
          eq(messages.conversationId, d.conversationId),
          eq(messages.direction, "out"),
          eq(messages.source, "ai_agent"),
          gte(messages.createdAt, since),
        ),
      )
      .limit(1);
    if (out) {
      await db
        .update(aiAgentDrafts)
        .set({ status: "enviado" })
        .where(and(eq(aiAgentDrafts.id, d.id), eq(aiAgentDrafts.organizationId, d.organizationId), eq(aiAgentDrafts.status, "enviando")));
    } else {
      await releaseDraft(d.organizationId, d.id, d.conversationId);
    }
  }
  return stuck.length;
}
