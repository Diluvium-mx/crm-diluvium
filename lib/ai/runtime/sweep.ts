// Barrido periódico del runtime del agente (cada minuto, en el worker):
// 1. Reactiva los "pasar a humano" cuyo plazo venció (handover_reactivate_hours),
//    aunque el cliente no haya vuelto a escribir (la bandeja deja de mostrarlos pausados).
// 2. Recoge conversaciones con un entrante sin atender y sin job (p. ej. Redis
//    no respondió al programar): la BD es la fuente de verdad; la cola solo acelera.
// Es mantenimiento de sistema (todas las organizaciones), como el barrido de webhooks.
import { and, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, conversations, messages } from "@/lib/db/schema";
import { SEND_UNCONFIRMED, SEND_UNKNOWN } from "@/lib/messaging/rules";
import { releaseDraft } from "./manual";
import { addContactTag, retainRemainder, setAgentState } from "./state";
import { TAG_HUMAN_REVIEW } from "./tags";

// Un entrante con este número de errores del agente ya no se reintenta solo
// (los errores quedan en ai_usage como rastro).
export const MAX_ERRORS_PER_MESSAGE = 5;
const ORPHAN_MIN_AGE_SECONDS = 90;
// El barrido rescata fallas de la cola (Redis no respondió al programar), no
// contesta historia: un entrante de hace más de esto ya no se responde solo.
export const ORPHAN_MAX_AGE_MINUTES = 30;

export async function reactivateExpiredHandovers(now: Date): Promise<number> {
  // Si un vendedor contestó DURANTE el pase a humano, NO se reactiva: pasa a
  // pausado_humano (reactivación manual), aunque el gancho no lo haya alcanzado a marcar.
  await db.execute(sql`
    update conversations c
       set agent_state = 'pausado_humano', agent_paused_until = null, agent_state_changed_at = ${ts(now)}
     where c.agent_state = 'pausado_handover'
       and c.agent_paused_until is not null and c.agent_paused_until <= ${ts(now)}
       and exists (
         select 1 from messages m
          where m.conversation_id = c.id and m.organization_id = c.organization_id
            and m.direction = 'out' and m.source in ('crm', 'business_app') and m.status <> 'failed'
            and coalesce(m.sent_at, m.created_at) > coalesce(c.agent_state_changed_at, '-infinity'::timestamp)
       )
  `);
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

// Un borrador aprobado que quedó en "enviando" (el proceso murió a la mitad, o
// alguna burbuja quedó "pending" con resultado desconocido) se concilia con el
// ESTADO REAL de los salientes del agente desde la aprobación:
//   - ninguno → no salió nada: vuelve a "pendiente" (u obsoleto si ya hay otro);
//   - alguno fallido (incl. sin confirmar vencido) → "obsoleto": el fallo se ve en
//     el hilo y NO se reenvía solo (podría duplicar);
//   - alguno todavía en camino ("queued") → se espera;
//   - todos confirmados → "enviado".
export const DRAFT_SENDING_STUCK_MS = 10 * 60_000;

export async function reconcileStuckDrafts(now: Date): Promise<number> {
  const stuck = await db
    .select({
      id: aiAgentDrafts.id,
      organizationId: aiAgentDrafts.organizationId,
      conversationId: aiAgentDrafts.conversationId,
      resolvedAt: aiAgentDrafts.resolvedAt,
      bubbles: aiAgentDrafts.bubbles,
    })
    .from(aiAgentDrafts)
    .where(and(eq(aiAgentDrafts.status, "enviando"), lt(aiAgentDrafts.resolvedAt, new Date(now.getTime() - DRAFT_SENDING_STUCK_MS))))
    .limit(100);
  let resolved = 0;
  for (const d of stuck) {
    const since = new Date((d.resolvedAt ?? now).getTime() - 5_000);
    const outs = await db
      .select({ status: messages.status })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, d.organizationId),
          eq(messages.conversationId, d.conversationId),
          eq(messages.direction, "out"),
          eq(messages.source, "ai_agent"),
          gte(messages.createdAt, since),
        ),
      );
    const setStatus = (status: "enviado" | "obsoleto") =>
      db
        .update(aiAgentDrafts)
        .set({ status })
        .where(and(eq(aiAgentDrafts.id, d.id), eq(aiAgentDrafts.organizationId, d.organizationId), eq(aiAgentDrafts.status, "enviando")));
    if (outs.length === 0) await releaseDraft(d.organizationId, d.id, d.conversationId);
    else if (outs.some((m) => m.status === "failed")) await setStatus("obsoleto");
    else if (outs.some((m) => m.status === "queued")) continue; // aún en camino
    else if (outs.length < d.bubbles.length) {
      // Salió solo una parte (el proceso se interrumpió): lo que faltó queda visible y
      // la conversación pasa a revisión humana; nunca se reenvía solo.
      await retainRemainder(
        d.organizationId,
        d.id,
        d.conversationId,
        d.bubbles.slice(outs.length),
        `El envío se interrumpió: salieron ${outs.length} de ${d.bubbles.length} burbujas; revisa el hilo antes de mandar el resto.`,
      );
      const [c] = await db
        .select({ contactId: conversations.contactId, agentState: conversations.agentState })
        .from(conversations)
        .where(and(eq(conversations.id, d.conversationId), eq(conversations.organizationId, d.organizationId)))
        .limit(1);
      if (c?.agentState === "activo") {
        await setAgentState(d.organizationId, d.conversationId, "pausado_antibucle", { now });
        await addContactTag(d.organizationId, c.contactId, TAG_HUMAN_REVIEW);
      }
    } else await setStatus("enviado");
    resolved++;
  }
  return resolved;
}

// AUTO con envío fallido: se pausa en "revisión humana" + etiqueta (sin regenerar ni
// reenviar: podría duplicar) la conversación con el agente activo que, DESPUÉS del
// último corte (reactivación / cambio de estado), tiene:
//   - un saliente del agente fallido SIN CONFIRMAR sin una respuesta humana posterior
//     (aunque no sea el último: p. ej. 1ª burbuja ambigua y la 2ª confirmada), o
//   - como ÚLTIMO saliente uno del agente fallido (también un rechazo definitivo que
//     llegó después de "pending": el cliente no recibió la respuesta).
// Sin límite de antigüedad (una caída larga del worker no las pierde); el corte evita
// volver a pausar tras "Reactivar". Va antes que findOrphanConversations.
export async function pauseOnFailedAgentSends(now: Date): Promise<number> {
  const rows = await db.execute<{ id: string; organization_id: string; contact_id: string }>(sql`
    select c.id, c.organization_id, c.contact_id
    from conversations c
    join channels ch on ch.id = c.channel_id and ch.organization_id = c.organization_id
    join lateral (
      select m.source, m.status, m.created_at
      from messages m
      where m.conversation_id = c.id and m.organization_id = c.organization_id and m.direction = 'out'
      order by coalesce(m.sent_at, m.created_at) desc, m.created_at desc
      limit 1
    ) last on true
    where ch.ai_agent_mode <> 'off'
      and c.agent_state = 'activo'
      and (
        (last.source = 'ai_agent' and last.status = 'failed'
          and last.created_at > coalesce(c.agent_state_changed_at, '-infinity'::timestamp))
        or exists (
          select 1 from messages f
           where f.conversation_id = c.id and f.organization_id = c.organization_id
             and f.direction = 'out' and f.source = 'ai_agent' and f.status = 'failed'
             and (f.error_code = ${SEND_UNCONFIRMED} or f.error_code like ${`${SEND_UNKNOWN}%`})
             and f.created_at > coalesce(c.agent_state_changed_at, '-infinity'::timestamp)
             and not exists (
               select 1 from messages h
                where h.conversation_id = c.id and h.organization_id = c.organization_id
                  and h.direction = 'out' and h.source in ('crm', 'business_app') and h.status <> 'failed'
                  and h.created_at > f.created_at
             )
        )
      )
    limit 50
  `);
  for (const r of rows) {
    await setAgentState(r.organization_id, r.id, "pausado_antibucle", { now });
    await addContactTag(r.organization_id, r.contact_id, TAG_HUMAN_REVIEW);
  }
  return rows.length;
}
