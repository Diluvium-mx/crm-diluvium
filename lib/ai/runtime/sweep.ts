// Barrido periódico del runtime del agente (cada minuto, en el worker):
// 1. Recoge conversaciones con un entrante sin atender y sin job (p. ej. Redis
//    no respondió al programar): la BD es la fuente de verdad; la cola solo acelera.
// 2. Concilia los planes de burbujas que quedaron "enviando" (reinicio del worker).
// 3. Deja un aviso al vendedor por cada respuesta del agente que WhatsApp rechazó o
//    no confirmó (sin pausar: el agente siempre contesta, 23-sep-2026).
// Es mantenimiento de sistema (todas las organizaciones), como el barrido de webhooks.
import { and, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, messages } from "@/lib/db/schema";
import { isAmbiguousSendError, SEND_UNCONFIRMED, SEND_UNKNOWN } from "@/lib/messaging/rules";
import { holdAgentForReview, recordAgentError } from "./agent-error";
import { agentAtSql, answeredOnlySql, workflowFillerSql } from "./context";
import { hiddenNoticeSql } from "@/lib/messaging/unavailable";
import { sendErrorBody } from "./model-errors";
import { bubbleMessageId, holdForRetry } from "./saved-reply";

// Un entrante con este número de errores del agente ya no se reintenta solo
// (los errores quedan en ai_usage como rastro).
export const MAX_ERRORS_PER_MESSAGE = 5;
const ORPHAN_MIN_AGE_SECONDS = 90;
// El barrido rescata fallas de la cola (Redis no respondió al programar), no
// contesta historia: un entrante de hace más de esto ya no se responde solo.
export const ORPHAN_MAX_AGE_MINUTES = 30;
// Avisos de envíos fallidos: solo los recientes (no se avisa historia al desplegar).
export const FAILED_SEND_NOTICE_HOURS = 24;

// Opciones del bot → horario: al ABRIR, se atienden los chats cuyo último mensaje es del
// cliente, sin respuesta y dentro de la ventana de 24 h (los que llegaron con el bot
// cerrado). Solo organizaciones CON horario; se reparten poco a poco (worker.ts).
export const OPENING_MAX_AGE_HOURS = 24;
export const OPENING_BATCH = 12;
export const OPENING_STAGGER_MS = 5_000;

export type OrphanConversation = { conversationId: string; organizationId: string };

// Fechas como ISO con cast: en SQL crudo el driver no serializa Date, y así se
// comparan igual que las columnas timestamp que drizzle escribe (UTC).
const ts = (d: Date) => sql`${d.toISOString()}::timestamp`;

// Huérfanos de siempre: organizaciones SIN horario (con horario, lo pendiente lo
// reparte findPendingAtOpening al abrir; fuera de horario no se contesta nada).
export async function findOrphanConversations(now: Date, limit = 50): Promise<OrphanConversation[]> {
  return findUnanswered(now, { since: new Date(now.getTime() - ORPHAN_MAX_AGE_MINUTES * 60_000), withSchedule: false, limit });
}

export async function findPendingAtOpening(now: Date, limit = OPENING_BATCH): Promise<OrphanConversation[]> {
  return findUnanswered(now, { since: new Date(now.getTime() - OPENING_MAX_AGE_HOURS * 3_600_000), withSchedule: true, limit });
}

async function findUnanswered(now: Date, opts: { since: Date; withSchedule: boolean; limit: number }): Promise<OrphanConversation[]> {
  const scheduleFilter = opts.withSchedule
    ? sql`and exists (select 1 from ai_config a where a.organization_id = c.organization_id and a.bot_schedule is not null)`
    : sql`and not exists (select 1 from ai_config a where a.organization_id = c.organization_id and a.bot_schedule is not null)`;
  const rows = await db.execute<UnansweredRow>(
    unansweredSql(now, { since: opts.since, olderThan: new Date(now.getTime() - ORPHAN_MIN_AGE_SECONDS * 1000), extra: scheduleFilter, limit: opts.limit }),
  );
  return rows.map((r) => ({ conversationId: r.id, organizationId: r.organization_id }));
}

// Alarma "bot callado" (lib/monitoring/bot-silence.ts): lo que el bot tendría que haber
// contestado y no contestó, con la hora del último entrante. MISMAS reglas que el barrido
// (por construcción: la misma consulta) y además sin lo importado del celular. El horario
// del bot lo evalúa quien llama (por organización).
export type UnansweredForMonitor = { conversationId: string; organizationId: string; lastInboundAt: Date };

export async function findUnansweredForMonitor(
  now: Date,
  opts: { olderThan: Date; organizationId?: string; limit?: number },
): Promise<UnansweredForMonitor[]> {
  const org = opts.organizationId ? sql`and c.organization_id = ${opts.organizationId}` : sql``;
  const rows = await db.execute<UnansweredRow>(
    unansweredSql(now, {
      // La ventana de WhatsApp dura 24 h: nada más viejo se puede contestar.
      since: new Date(now.getTime() - OPENING_MAX_AGE_HOURS * 3_600_000),
      olderThan: opts.olderThan,
      extra: sql`and last.imported_at is null ${org}`,
      limit: opts.limit ?? 1_000,
    }),
  );
  return rows.map((r) => ({ conversationId: r.id, organizationId: r.organization_id, lastInboundAt: new Date(Number(r.last_ms)) }));
}

type UnansweredRow = { id: string; organization_id: string; last_ms: number };

// Conversaciones con el último mensaje del cliente SIN ATENDER según las reglas del bot:
// canal Encendido, agente activo, ventana abierta, entrante posterior a los cortes
// (encender el canal, "Reactivar"), sin respuesta/plan/decisión del agente y sin tarjeta
// de error sin atender. `since` acota lo reciente; `olderThan`, lo que ya esperó.
function unansweredSql(now: Date, opts: { since: Date; olderThan: Date; extra: SQL; limit: number }): SQL {
  const { since, olderThan, extra, limit } = opts;
  return sql`
    select c.id, c.organization_id, (extract(epoch from last.created_at) * 1000)::float8 as last_ms
    from conversations c
    join channels ch on ch.id = c.channel_id
    join lateral (
      select m.id, m.direction, m.created_at, m.sent_at, m.metadata, m.imported_at
      from messages m
      where m.conversation_id = c.id and m.status <> 'failed'
        -- Igual que pendingInbound (Fase D): un aviso interno o la media de un
        -- workflow por palabra clave no cuentan como respuesta al cliente (salvo el último
        -- mensaje de un workflow «es la respuesta» del agente: workflowFillerSql).
        and m.type <> 'system_note'
        and not ${workflowFillerSql("m")}
        -- Un entrante que ya contestó el último mensaje de un workflow «es la respuesta» por
        -- palabra clave (contestaA) tampoco cuenta: lo pendiente es lo demás de la ráfaga.
        and not ${answeredOnlySql("m")}
        -- Aviso "no disponible" en verificación o sombra (lib/messaging/unavailable.ts): no se
        -- contesta (antes el barrido lo tomaba a los 90 s y el modelo improvisaba).
        and not ${hiddenNoticeSql(sql.raw("m.metadata"))}
      -- Parte 1: una burbuja reenviada cuenta en la hora del entrante que la originó
      -- (respondeHasta): si el cliente escribió mientras la tarjeta esperaba, lo suyo
      -- queda como lo último y el barrido lo rescata.
      -- Un entrante va en la hora del Agente IA (mensaje tapado, 5-oct-2026): si llegó después
      -- de una respuesta, queda después de ella aunque WhatsApp diga que se escribió antes.
      order by coalesce((m.metadata->>'respondeHasta')::timestamp, ${agentAtSql("m")}) desc, m.created_at desc
      limit 1
    ) last on true
    where ch.ai_agent_mode = 'auto'
      and c.agent_state = 'activo'
      and c.window_expires_at > ${ts(now)}
      and c.last_message_at > ${ts(since)}
      ${extra}
      and last.direction = 'in'
      and last.created_at < ${ts(olderThan)}
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
          -- Complemento (9-oct-2026): la respuesta que pidió un workflow «es la respuesta» de solo
          -- archivos queda ANTES de la marca de revisión de su archivo (revisaDesde) y no cuenta:
          -- el mensaje sigue esperando que el agente lo revise.
          and not exists (
            select 1 from messages a
            where a.organization_id = c.organization_id and a.conversation_id = c.id
              and a.direction = 'out' and a.status <> 'failed'
              and a.metadata->>'contestaA' = last.id and coalesce(a.metadata ? 'revisaDesde', false)
              and u.created_at <= (a.metadata->>'revisaDesde')::timestamp
          )
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
  `;
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
      triggerMessageId: aiAgentDrafts.triggerMessageId,
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
      .select({ status: messages.status, errorCode: messages.errorCode })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, d.organizationId),
          eq(messages.conversationId, d.conversationId),
          eq(messages.direction, "out"),
          eq(messages.source, "ai_agent"),
          // Desde la parte 1 las burbujas tienen id determinista: cuentan aunque la fila
          // sea anterior (un reenvío retoma la fila del primer intento).
          or(gte(messages.createdAt, since), inArray(messages.id, d.bubbles.map((_, i) => bubbleMessageId(d.id, i)))),
          // Ni avisos internos ni media/texto de corridas de workflow: no son burbujas del plan.
          sql`${messages.type} <> 'system_note' and not exists (
            select 1 from workflow_runs r
            where r.organization_id = ${messages.organizationId} and r.conversation_id = ${messages.conversationId}
              and r.message_ids ? ${messages.id}
          )`,
        ),
      );
    if (outs.some((m) => m.status === "queued")) continue; // aún en camino
    // Parte 1 (26-sep): el 1er mensaje se RECHAZÓ y el worker se reinició antes de
    // guardar la respuesta y la tarjeta: queda guardada ("pendiente") con su tarjeta
    // "Reintentar / Apagar", igual que si no se hubiera reiniciado. Nunca "enviado"
    // (el cliente no recibió nada) ni otra llamada al modelo.
    // Solo rechazos EXPLÍCITOS: uno "sin confirmar" pudo llegar (sigue el camino de abajo:
    // aviso para revisar el celular, sin reenviar).
    if (outs.length > 0 && outs.every((m) => m.status === "failed" && !isAmbiguousSendError(m.errorCode)) && d.triggerMessageId) {
      if (await holdForRetry(d.organizationId, d.id)) {
        await recordAgentError({
          organizationId: d.organizationId,
          conversationId: d.conversationId,
          messageId: d.triggerMessageId,
          body: sendErrorBody("El envío se interrumpió (el servidor se reinició) y WhatsApp no recibió la respuesta."),
        });
        resolved++;
      }
      continue;
    }
    const status = outs.length === 0 ? "obsoleto" : "enviado";
    const closed = await db
      .update(aiAgentDrafts)
      .set({ status })
      .where(and(eq(aiAgentDrafts.id, d.id), eq(aiAgentDrafts.organizationId, d.organizationId), eq(aiAgentDrafts.status, "enviando")))
      .returning({ id: aiAgentDrafts.id });
    if (closed.length === 0) continue;
    const ok = outs.filter((m) => m.status !== "failed").length;
    if (outs.length > 0 && ok < d.bubbles.length) {
      await holdAgentForReview({
        organizationId: d.organizationId,
        conversationId: d.conversationId,
        messageId: d.triggerMessageId,
        body: `El envío de una respuesta del Agente IA se interrumpió: salieron ${ok} de ${d.bubbles.length} mensajes. No se envió: «${d.bubbles.slice(ok).join(" / ")}».`,
      });
    }
    resolved++;
  }
  return resolved;
}

// Respuesta del agente que WhatsApp rechazó o no confirmó: una tarjeta por mensaje (índice único
// message_id+kind) y el Agente IA en pausa en el chat hasta que el vendedor lo revise (5-oct-2026,
// dueño; antes era un aviso y seguía contestando). Nunca reenvía (podría duplicar). Si el chat ya
// tiene una tarjeta abierta (p. ej. la del envío que falló en run.ts), no se agrega otra.
export async function noticeFailedAgentSends(now: Date): Promise<number> {
  const since = new Date(now.getTime() - FAILED_SEND_NOTICE_HOURS * 3_600_000);
  const rows = await db.execute<{ id: string; organization_id: string; conversation_id: string; error_code: string | null }>(sql`
    select m.id, m.organization_id, m.conversation_id, m.error_code
    from messages m
    where m.direction = 'out' and m.source = 'ai_agent' and m.status = 'failed'
      and m.created_at > ${ts(since)}
      and not exists (select 1 from ai_agent_notices n where n.message_id = m.id and n.kind in ('envio', 'agente_error'))
      and not exists (
        select 1 from ai_agent_notices n
        where n.organization_id = m.organization_id and n.conversation_id = m.conversation_id
          and n.kind = 'agente_error' and n.resolved_at is null
      )
    limit 50
  `);
  let added = 0;
  for (const r of rows) {
    const ambiguous = r.error_code === SEND_UNCONFIRMED || (r.error_code ?? "").startsWith(SEND_UNKNOWN);
    const body = ambiguous
      ? "WhatsApp no confirmó una respuesta del Agente IA: revisa en el celular si le llegó al cliente."
      : `WhatsApp rechazó una respuesta del Agente IA${r.error_code ? ` (código ${r.error_code})` : ""}: el cliente no la recibió.`;
    await holdAgentForReview({ organizationId: r.organization_id, conversationId: r.conversation_id, messageId: r.id, body });
    added++;
  }
  return added;
}

// Parte 1 (26-sep): "Reintentar" ya resolvió la tarjeta pero su corrida se perdió
// (Redis se reinició, el job desapareció): la respuesta guardada sigue "pendiente" y el
// barrido de huérfanos no la ve (un plan no obsoleto cuenta como atendido). Se vuelve a
// programar la corrida (reenvía el MISMO texto, sin modelo). Solo las recientes.
export const LOST_RETRY_MIN_AGE_SECONDS = 90;
export const LOST_RETRY_MAX_AGE_HOURS = 24;

export async function findLostRetries(now: Date, limit = 50): Promise<OrphanConversation[]> {
  const rows = await db.execute<{ conversation_id: string; organization_id: string }>(sql`
    select d.conversation_id, d.organization_id
    from ai_agent_drafts d
    join conversations c on c.id = d.conversation_id and c.organization_id = d.organization_id
    where d.status = 'pendiente' and c.agent_state = 'activo'
      and exists (
        select 1 from ai_agent_notices n
        where n.organization_id = d.organization_id and n.conversation_id = d.conversation_id
          and n.kind = 'agente_error' and n.resolution = 'reintentar'
          and n.resolved_at > d.created_at
          and n.resolved_at < ${ts(new Date(now.getTime() - LOST_RETRY_MIN_AGE_SECONDS * 1000))}
          and n.resolved_at > ${ts(new Date(now.getTime() - LOST_RETRY_MAX_AGE_HOURS * 3_600_000))}
      )
      and not exists (
        select 1 from ai_agent_notices n
        where n.organization_id = d.organization_id and n.conversation_id = d.conversation_id
          and n.kind = 'agente_error' and n.resolved_at is null
      )
    limit ${limit}
  `);
  return rows.map((r) => ({ conversationId: r.conversation_id, organizationId: r.organization_id }));
}
