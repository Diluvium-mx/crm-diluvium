// Barrido periódico del runtime del agente (cada minuto, en el worker):
// 1. Recoge conversaciones con un entrante sin atender y sin job (p. ej. Redis
//    no respondió al programar): la BD es la fuente de verdad; la cola solo acelera.
// 2. Concilia los planes de burbujas que quedaron "enviando" (reinicio del worker).
// 3. Deja un aviso al vendedor por cada respuesta del agente que WhatsApp rechazó o
//    no confirmó (sin pausar: el agente siempre contesta, 23-sep-2026).
// Es mantenimiento de sistema (todas las organizaciones), como el barrido de webhooks.
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, messages } from "@/lib/db/schema";
import { SEND_UNCONFIRMED, SEND_UNKNOWN } from "@/lib/messaging/rules";
import { addNotice } from "./notices";

// Un entrante con este número de errores del agente ya no se reintenta solo
// (los errores quedan en ai_usage como rastro).
export const MAX_ERRORS_PER_MESSAGE = 5;
const ORPHAN_MIN_AGE_SECONDS = 90;
// El barrido rescata fallas de la cola (Redis no respondió al programar), no
// contesta historia: un entrante de hace más de esto ya no se responde solo.
export const ORPHAN_MAX_AGE_MINUTES = 30;
// Avisos de envíos fallidos: solo los recientes (no se avisa historia al desplegar).
export const FAILED_SEND_NOTICE_HOURS = 24;

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
      select m.id, m.direction, m.created_at, m.sent_at
      from messages m
      where m.conversation_id = c.id and m.status <> 'failed'
        -- Igual que pendingInbound (Fase D): un aviso interno o la media de un
        -- workflow por palabra clave no cuentan como respuesta al cliente.
        and m.type <> 'system_note'
        and not exists (
          select 1 from workflow_runs r
          where r.organization_id = m.organization_id and r.conversation_id = m.conversation_id
            and r.trigger in ('keyword', 'agent') and r.message_ids ? m.id
        )
      order by coalesce(m.sent_at, m.created_at) desc, m.created_at desc
      limit 1
    ) last on true
    where ch.ai_agent_mode = 'auto'
      and c.agent_state = 'activo'
      and c.window_expires_at > ${ts(now)}
      and c.last_message_at > ${ts(since)}
      and last.direction = 'in'
      and last.created_at < ${ts(new Date(now.getTime() - ORPHAN_MIN_AGE_SECONDS * 1000))}
      and last.created_at > ${ts(since)}
      -- Lo escrito ANTES de encender el canal o de reactivar al agente no se
      -- contesta solo: espera al siguiente mensaje del cliente. Contra la
      -- reactivación cuenta la hora en que el cliente lo ESCRIBIÓ (WhatsApp): un
      -- mensaje escrito con el bot apagado que llegó tarde tampoco ("Apagar bot").
      -- WhatsApp da segundos enteros: lo escrito en el mismo segundo del corte es nuevo.
      and last.created_at > coalesce(ch.ai_agent_mode_changed_at, '-infinity'::timestamp)
      and coalesce(last.sent_at, last.created_at) >= coalesce(date_trunc('second', c.agent_state_changed_at), '-infinity'::timestamp)
      and not exists (
        select 1 from ai_usage u
        where u.organization_id = c.organization_id and u.message_id = last.id
          and u.outcome in ('sent', 'draft', 'skipped', 'handover')
      )
      -- Un plan/borrador OBSOLETO no cuenta (p. ej. la 1ª burbuja falló en los 3 intentos):
      -- el barrido lo rescata hasta MAX_ERRORS_PER_MESSAGE.
      and not exists (select 1 from ai_agent_drafts d where d.organization_id = c.organization_id and d.trigger_message_id = last.id and d.status <> 'obsoleto')
      and (select count(*) from ai_usage u where u.message_id = last.id and u.outcome = 'error') < ${MAX_ERRORS_PER_MESSAGE}
      -- Fase E ("reenvío seguro"): con la tarjeta de error sin atender no se reintenta solo.
      and not exists (
        select 1 from ai_agent_notices n
        where n.organization_id = c.organization_id and n.conversation_id = c.id
          and n.kind = 'agente_error' and n.resolved_at is null
          -- misma regla que hasUnresolvedAgentError: una tarjeta anterior a "Reactivar"
          -- o al encendido del canal ya no bloquea
          and n.created_at > coalesce(c.agent_state_changed_at, '-infinity'::timestamp)
          and n.created_at > coalesce(ch.ai_agent_mode_changed_at, '-infinity'::timestamp)
      )
    limit ${limit}
  `);
  return rows.map((r) => ({ conversationId: r.id, organizationId: r.organization_id }));
}

// Un PLAN de burbujas que quedó "enviando" (el worker se reinició a la mitad, o
// una burbuja quedó "pending" con resultado desconocido) se concilia con el ESTADO
// REAL de los salientes del agente guardados desde el plan:
//   - ninguno → no salió nada: "obsoleto" (el barrido de huérfanos vuelve a atender
//     el entrante si es reciente; el plan viejo nunca se reenvía);
//   - alguno todavía en camino ("queued") → se espera;
//   - si no → "enviado"; lo que no salió (o falló) queda en un aviso al vendedor.
//     Nunca se reenvía solo (podría duplicar).
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
    // Solo salientes del agente guardados DESDE el plan. created_at y resolved_at
    // salen del MISMO reloj (now() de Postgres): una respuesta anterior —aunque sea
    // de segundos antes— no cuenta como burbuja de este plan. No se usa sent_at: el
    // eco del proveedor lo reemplaza con la hora de Zernio/WhatsApp.
    const since = d.resolvedAt ?? now;
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
          // Ni avisos internos ni media/texto de corridas de workflow: no son burbujas del plan.
          sql`${messages.type} <> 'system_note' and not exists (
            select 1 from workflow_runs r
            where r.organization_id = ${messages.organizationId} and r.conversation_id = ${messages.conversationId}
              and r.message_ids ? ${messages.id}
          )`,
        ),
      );
    if (outs.some((m) => m.status === "queued")) continue; // aún en camino
    const status = outs.length === 0 ? "obsoleto" : "enviado";
    const closed = await db
      .update(aiAgentDrafts)
      .set({ status })
      .where(and(eq(aiAgentDrafts.id, d.id), eq(aiAgentDrafts.organizationId, d.organizationId), eq(aiAgentDrafts.status, "enviando")))
      .returning({ id: aiAgentDrafts.id });
    if (closed.length === 0) continue;
    const ok = outs.filter((m) => m.status !== "failed").length;
    if (outs.length > 0 && ok < d.bubbles.length) {
      await addNotice({
        organizationId: d.organizationId,
        conversationId: d.conversationId,
        kind: "envio",
        body: `El envío de una respuesta del agente se interrumpió: salieron ${ok} de ${d.bubbles.length} mensajes. No se envió: «${d.bubbles.slice(ok).join(" / ")}». Revisa el hilo.`,
      });
    }
    resolved++;
  }
  return resolved;
}

// Respuesta del agente que WhatsApp rechazó o no confirmó: un aviso por mensaje
// (índice único message_id+kind), sin pausar ni reenviar (podría duplicar).
export async function noticeFailedAgentSends(now: Date): Promise<number> {
  const since = new Date(now.getTime() - FAILED_SEND_NOTICE_HOURS * 3_600_000);
  const rows = await db.execute<{ id: string; organization_id: string; conversation_id: string; error_code: string | null }>(sql`
    select m.id, m.organization_id, m.conversation_id, m.error_code
    from messages m
    where m.direction = 'out' and m.source = 'ai_agent' and m.status = 'failed'
      and m.created_at > ${ts(since)}
      and not exists (select 1 from ai_agent_notices n where n.message_id = m.id and n.kind = 'envio')
    limit 50
  `);
  let added = 0;
  for (const r of rows) {
    const ambiguous = r.error_code === SEND_UNCONFIRMED || (r.error_code ?? "").startsWith(SEND_UNKNOWN);
    const body = ambiguous
      ? "WhatsApp no confirmó una respuesta del agente: revisa en el celular si le llegó al cliente."
      : `WhatsApp rechazó una respuesta del agente${r.error_code ? ` (código ${r.error_code})` : ""}: el cliente no la recibió.`;
    if (await addNotice({ organizationId: r.organization_id, conversationId: r.conversation_id, kind: "envio", body, messageId: r.id })) added++;
  }
  return added;
}
