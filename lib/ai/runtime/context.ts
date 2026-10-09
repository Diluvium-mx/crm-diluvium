// Lecturas de BD del runtime del agente: la conversación y su canal, los
// entrantes pendientes, el historial completo y la idempotencia.
// Multi-tenant (CLAUDE.md §7): TODA lectura filtra por organization_id, además
// del id. Un id de otra organización no encuentra nada (defensa en profundidad:
// los ids vienen de la cola interna, pero nunca se confía en ellos solos).
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, ne, not, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, aiUsage, channels, conversations, messages, workflowRuns, workflows } from "@/lib/db/schema";
import { MAX_HISTORY_CHARS, messageText } from "./transcript";
import { FINAL_OUTCOMES } from "./usage";
import { asksSomething } from "./unanswered";
import { hiddenNoticeSql, isUnavailableNotice, lateContentAtSql, noDisponibleEstado, UNAVAILABLE_HISTORY_NOTE } from "@/lib/messaging/unavailable";
import type { LoopMessage } from "./contestador";

export type ConversationRow = typeof conversations.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

// Hora del mensaje según WhatsApp (sent_at) o, si falta, cuándo se guardó.
const waAt = sql`coalesce(${messages.sentAt}, ${messages.createdAt})`;

/**
 * Hora con la que el Agente IA ordena un mensaje (mensaje tapado, 5-oct-2026). WhatsApp da la hora
 * en que el cliente ESCRIBIÓ y el mensaje llega de 2 a 40 s después. Si en ese hueco salió una
 * respuesta del CRM, con la hora de WhatsApp el mensaje quedaba ANTES de esa respuesta: contaba como
 * contestado sin que nadie lo hubiera leído (34 mensajes del 30-sep al 5-oct, 6 chats sin respuesta;
 * «¿Realizan trabajos en Oaxaca?» llegó 5 s después de la pregunta del Agente IA y nunca se contestó).
 * Para el Agente IA y el lector, un entrante vivo va DESPUÉS de todo saliente que ya existía cuando
 * llegó (1 ms después del más reciente). La Bandeja, la ventana de 24 h y lo demás siguen con la hora
 * de WhatsApp. El historial copiado del celular (imported_at) conserva su hora.
 * `alias`: la fila de `messages` evaluada (constante del código, nunca un dato).
 */
export function agentAtSql(alias: "messages" | "i" | "c" | "t" | "m"): SQL {
  const m = sql.raw(alias);
  return sql`(case when ${m}.direction = 'in' and ${m}.imported_at is null then greatest(coalesce(${m}.sent_at, ${m}.created_at), (
    select max(coalesce(o.sent_at, o.created_at)) + interval '1 millisecond' from messages o
    where o.organization_id = ${m}.organization_id and o.conversation_id = ${m}.conversation_id
      and o.direction = 'out' and o.status <> 'failed' and o.type <> 'system_note' and o.created_at < ${m}.created_at
  )) else coalesce(${m}.sent_at, ${m}.created_at) end)`;
}
const agentAt = agentAtSql("messages");

const inConversation = (organizationId: string, conversationId: string) =>
  and(eq(messages.organizationId, organizationId), eq(messages.conversationId, conversationId));

export async function loadSnapshot(
  organizationId: string,
  conversationId: string,
): Promise<{ conversation: ConversationRow; channel: ChannelRow } | null> {
  const [row] = await db
    .select({ conversation: conversations, channel: channels })
    .from(conversations)
    .innerJoin(channels, and(eq(channels.id, conversations.channelId), eq(channels.organizationId, organizationId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

// Saliente mandado por una corrida de workflow por PALABRA CLAVE o del AGENTE: NO
// contesta al cliente (Fase D, 24-sep-2026: el workflow manda la media y el agente
// contesta el resto del mismo mensaje, como en GHL; y lo que el cliente escriba durante
// la espera de 30 s de la tabla no queda "atendido" por la imagen).
// EXCEPCIÓN (28-sep-2026, pregunta duplicada): el último mensaje de un workflow del AGENTE con
// «El workflow es la respuesta» y textos (su texto propio no salió) contestaba hasta el último
// mensaje que el agente leyó (`respondeHasta`, ANSWERS_UNTIL_KEY). Desde el 9-oct-2026 va como por
// palabra clave, con la marca de revisión (complemento); `respondeHasta` queda para el texto del
// Agente IA que sale como pie del archivo o solo (executor.ts).
// Por PALABRA CLAVE (29-sep-2026, bug de la ráfaga) el último mensaje contesta SOLO su
// disparador (`contestaA`, ANSWERS_ONLY_KEY): sigue siendo relleno aquí (no cierra lo anterior)
// y pendingInbound excluye ese único mensaje. `alias`: la fila de `messages` evaluada
// (constante del código, nunca un dato).
export function workflowFillerSql(alias: "messages" | "o" | "m"): SQL {
  const m = sql.raw(alias);
  return sql`(not coalesce(${m}.metadata ? 'respondeHasta', false) and exists (
    select 1 from workflow_runs r
    where r.organization_id = ${m}.organization_id and r.conversation_id = ${m}.conversation_id
      and r.trigger in ('keyword', 'agent') and r.message_ids ? ${m}.id
  ))`;
}

// Saliente que CUENTA como respuesta al cliente (cierra los pendientes): no
// fallido, no aviso interno (system_note: solo lo ve el vendedor) y no relleno de
// un workflow (workflowFillerSql).
const closesPending = sql`${messages.type} <> 'system_note' and not ${workflowFillerSql("messages")}`;

// Último saliente que salió o va en camino (un envío FALLIDO no le respondió al
// cliente, así que no cierra los pendientes).
export async function lastOutbound(organizationId: string, conversationId: string): Promise<MessageRow | null> {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(inConversation(organizationId, conversationId), eq(messages.direction, "out"), ne(messages.status, "failed"), closesPending))
    .orderBy(desc(waAt), desc(messages.createdAt))
    .limit(1);
  return row ?? null;
}

// Entrantes posteriores al último saliente (lo que el agente debe atender), en
// orden cronológico. Se compara en SQL para no perder microsegundos en JS. Solo
// los MAX_PENDING más recientes: un remitente que manda miles de mensajes (spam,
// nunca hay saliente) no vuelve cuadrático el trabajo de cada entrante.
// El historial copiado del celular (imported_at) NUNCA está pendiente: un "gracias"
// sin contestar de hace meses no se responde junto con el primer mensaje vivo.
export const MAX_PENDING = 50;

// Parte 1 (26-sep-2026): una burbuja REENVIADA de una respuesta guardada solo contesta
// hasta el entrante que la originó (messages.metadata.respondeHasta = su hora exacta,
// escrita en SQL). Lo que el cliente escribió mientras la tarjeta esperaba sigue
// pendiente aunque sea anterior al reenvío (antes quedaba "contestado" y se perdía).
export const ANSWERS_UNTIL_KEY = "respondeHasta";
// 29-sep-2026 («El workflow es la respuesta» por palabra clave): el último mensaje de la corrida
// contesta SOLO el entrante cuyo id guarda (lib/ai/runtime/saved-reply.ts, markAnswersOnly).
export const ANSWERS_ONLY_KEY = "contestaA";
// 30-sep-2026 (caso «De que cd son y que precio tienen» → «Precio 2» contestó el precio y
// nadie contestó lo de la ciudad): el workflow contesta SU parte del mensaje, no todo. Junto a
// `contestaA` va esta marca: el entrante sigue pendiente hasta que el Agente IA lo revise y
// conteste lo que el workflow no cubrió (o decida que no falta nada). Las marcas anteriores (sin
// ella) siguen como antes: el workflow contestó todo.
export const ANSWERS_ONLY_REVIEW_KEY = "revisaAgente";
// 9-oct-2026 (complemento de un workflow «es la respuesta» que pidió el propio Agente IA, con
// archivos o con textos): junto a la marca de revisión va la hora en que salió su último mensaje. El
// registro de la respuesta que PIDIÓ el workflow (anterior) no cuenta como revisión; solo uno
// posterior a esta hora.
export const ANSWERS_REVIEW_SINCE_KEY = "revisaDesde";
// Entrante contestado uno por uno por un workflow (ANSWERS_ONLY_KEY) con un saliente que no falló
// y, si lleva la marca de revisión, que el Agente IA ya revisó (resultado final en ai_usage: lo
// contestó, decidió que no faltaba nada o lo tomó un vendedor; si la marca trae hora,
// ANSWERS_REVIEW_SINCE_KEY, solo un resultado posterior a ella).
// Ráfagas (9-oct-2026, dueño): con la marca de revisión, una vez revisado el disparador quedan
// contestados también los entrantes ANTERIORES a él (el agente leyó la ráfaga completa en modo
// complemento, complement.ts). Antes solo el disparador: si no faltaba nada, un «Buenas tardes» de la
// ráfaga quedaba pendiente y el barrido lo contestaba aparte ~90 s después (7 de 23 ráfagas del 1 al
// 9-oct). Mientras no se revise, lo anterior sigue pendiente (el barrido lo rescata). Las marcas sin
// revisión (anteriores al 30-sep) siguen cerrando solo su disparador (bug de la ráfaga, 29-sep).
// `alias`: la fila de `messages` evaluada (constante del código, nunca un dato).
export function answeredOnlySql(alias: "messages" | "m"): SQL {
  const m = sql.raw(alias);
  return sql`exists (
    select 1 from messages a
    join messages t on t.id = a.metadata->>'contestaA' and t.organization_id = a.organization_id and t.conversation_id = a.conversation_id
    where a.organization_id = ${m}.organization_id and a.conversation_id = ${m}.conversation_id
      and a.direction = 'out' and a.status <> 'failed' and a.metadata ? 'contestaA'
      and (
        (t.id = ${m}.id and not coalesce(a.metadata ? 'revisaAgente', false))
        or (coalesce(a.metadata ? 'revisaAgente', false) and t.created_at >= ${m}.created_at and exists (
          select 1 from ai_usage u
          where u.organization_id = t.organization_id and u.message_id = t.id
            and (not coalesce(a.metadata ? 'revisaDesde', false) or u.created_at > (a.metadata->>'revisaDesde')::timestamp)
            and u.outcome in (${sql.join(FINAL_OUTCOMES.map((o) => sql`${o}`), sql`, `)})
        ))
      )
  )`;
}

/**
 * Entrantes pendientes que un workflow «El workflow es la respuesta» ya contestó en parte (por
 * palabra clave o pedido por el propio agente) y que el Agente IA todavía debe revisar
 * (ANSWERS_ONLY_REVIEW_KEY): id del entrante → nombre del workflow. El agente contesta lo que
 * falte del mensaje (run.ts, modo complemento).
 */
export async function answeredByWorkflow(organizationId: string, conversationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ trigger_id: string; name: string }>(sql`
    select a.metadata->>'contestaA' as trigger_id, w.name
    from messages a
    join workflow_runs r on r.organization_id = a.organization_id and r.conversation_id = a.conversation_id and r.message_ids ? a.id
    join workflows w on w.id = r.workflow_id and w.organization_id = r.organization_id
    where a.organization_id = ${organizationId} and a.conversation_id = ${conversationId}
      and a.direction = 'out' and a.status <> 'failed'
      and coalesce(a.metadata ? 'revisaAgente', false)
      and a.metadata->>'contestaA' in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  return new Map(rows.map((r) => [r.trigger_id, r.name]));
}

export async function pendingInbound(organizationId: string, conversationId: string): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "in"),
        isNull(messages.importedAt),
        // Aviso "no disponible" en verificación o sombra de un real que llegó aparte:
        // no se atiende (lib/messaging/unavailable.ts). El confirmado sin contenido sí.
        not(hiddenNoticeSql(messages.metadata)),
        // Contenido real que llegó DESPUÉS de confirmarse "no disponible" (el Agente IA ya
        // pudo mandar el texto fijo): cuenta desde que llegó, para contestar lo que dice.
        sql`coalesce(${lateContentAtSql(messages.metadata)}, ${agentAt}) > coalesce((
          select max(coalesce((o.metadata->>'respondeHasta')::timestamp, o.sent_at, o.created_at)) from messages o
          where o.organization_id = ${organizationId} and o.conversation_id = ${conversationId}
            and o.direction = 'out' and o.status <> 'failed' and o.type <> 'system_note'
            and not ${workflowFillerSql("o")}
        ), '-infinity'::timestamp)`,
        // Contestado por el último mensaje de un workflow «es la respuesta» (solo ese mensaje).
        not(answeredOnlySql("messages")),
      ),
    )
    .orderBy(desc(agentAt), desc(messages.createdAt))
    .limit(MAX_PENDING);
  return rows.reverse();
}

// Tope de la espera del agente a un workflow «es la respuesta» en curso (worker reiniciado,
// cola lenta): pasado esto contesta igual; el cliente no se queda sin respuesta.
export const ANSWER_RUN_WAIT_MAX_MS = 3 * 60_000;

/**
 * ¿Va en camino (queued/running) una corrida con «El workflow es la respuesta» (29-sep-2026;
 * antes, 28-sep: "termina en pregunta"), disparada por uno de estos entrantes pendientes? Su
 * último mensaje contesta ese entrante: el agente espera a que termine en vez de contestar
 * encima (al terminar, lo demás de la ráfaga sigue pendiente). Por palabra clave, y también la
 * del propio Agente IA cuando su texto no salió (workflow con textos o archivos; run.ts).
 */
export async function answerRunInFlight(organizationId: string, conversationId: string, triggerIds: readonly string[], now: Date): Promise<boolean> {
  if (triggerIds.length === 0) return false;
  const [run] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .innerJoin(workflows, and(eq(workflows.id, workflowRuns.workflowId), eq(workflows.organizationId, organizationId)))
    .where(
      and(
        eq(workflowRuns.organizationId, organizationId),
        eq(workflowRuns.conversationId, conversationId),
        inArray(workflowRuns.trigger, ["keyword", "agent"]),
        inArray(workflowRuns.status, ["queued", "running"]),
        inArray(workflowRuns.triggerMessageId, [...triggerIds]),
        gt(workflowRuns.createdAt, new Date(now.getTime() - ANSWER_RUN_WAIT_MAX_MS)),
        eq(workflows.isAnswer, true),
      ),
    )
    .limit(1);
  return Boolean(run);
}

/**
 * Red contra el silencio (29-sep-2026, dueño): ¿ya le salió algo al cliente DESPUÉS de su
 * último mensaje (un workflow por palabra clave, media, texto), o está por salirle una corrida
 * por palabra clave de estos entrantes? Si sí, que el Agente IA no escriba nada es correcto
 * (p. ej. «Precio 2» ya contestó y terminó con su pregunta). Mismos salientes que el candado
 * anti-repetición (sin fallidos ni notas internas), pero con o sin texto.
 * La corrida solo cuenta si la disparó el ÚLTIMO mensaje del cliente (5-oct-2026): si el cliente
 * escribió después de que un workflow contestó un mensaje anterior («Quiero más información» →
 * Información, y luego «Que precio en euros»), lo nuevo sigue sin respuesta y no se debe callar.
 */
export async function sentToClientSinceLastInbound(organizationId: string, conversationId: string, triggerIds: readonly string[]): Promise<boolean> {
  const [out] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "out"),
        ne(messages.status, "failed"),
        ne(messages.type, "system_note"),
        sql`${waAt} > coalesce((
          select max(${agentAtSql("i")}) from messages i
          where i.organization_id = ${organizationId} and i.conversation_id = ${conversationId}
            and i.direction = 'in' and i.imported_at is null
        ), '-infinity'::timestamp)`,
      ),
    )
    .limit(1);
  if (out) return true;
  if (triggerIds.length === 0) return false;
  const [run] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, organizationId),
        eq(workflowRuns.conversationId, conversationId),
        eq(workflowRuns.trigger, "keyword"),
        inArray(workflowRuns.status, ["queued", "running", "done"]),
        inArray(workflowRuns.triggerMessageId, [...triggerIds]),
        sql`${workflowRuns.triggerMessageId} = (
          select i.id from messages i
          where i.organization_id = ${organizationId} and i.conversation_id = ${conversationId}
            and i.direction = 'in' and i.imported_at is null
          order by ${agentAtSql("i")} desc, i.created_at desc limit 1
        )`,
      ),
    )
    .limit(1);
  return Boolean(run);
}

/**
 * Textos que ya salieron al cliente DESPUÉS de su último mensaje (candado
 * anti-repetición, 28-sep-2026, lib/messaging/repeat): salientes que no fallaron (en
 * camino también), sin avisos internos, incluidos los de los workflows. El historial
 * copiado del celular no cuenta como "último mensaje".
 */
export const REPEAT_LOOKBACK_ROWS = 50;
export async function outboundTextsSinceLastInbound(organizationId: string, conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "out"),
        ne(messages.status, "failed"),
        ne(messages.type, "system_note"),
        isNotNull(messages.body),
        sql`${waAt} > coalesce((
          select max(${agentAtSql("i")}) from messages i
          where i.organization_id = ${organizationId} and i.conversation_id = ${conversationId}
            and i.direction = 'in' and i.imported_at is null
        ), '-infinity'::timestamp)`,
      ),
    )
    .orderBy(desc(waAt))
    .limit(REPEAT_LOOKBACK_ROWS);
  return rows.flatMap((r) => (r.body ? [r.body] : []));
}

/**
 * La última pregunta que se le hizo al cliente (pregunta sin contestar, 3-oct-2026,
 * ./unanswered.ts): el texto completo del saliente más reciente que pregunta algo (Agente IA,
 * workflow o vendedor; sin fallidos ni avisos internos), si salió hace menos de
 * UNANSWERED_WINDOW_MS. Más vieja, el cliente que regresa días después sí puede oírla otra vez.
 */
export const UNANSWERED_WINDOW_MS = 24 * 60 * 60_000;
export const UNANSWERED_LOOKBACK_ROWS = 20;
export async function lastQuestionAsked(organizationId: string, conversationId: string, now: Date): Promise<string | null> {
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "out"),
        ne(messages.status, "failed"),
        ne(messages.type, "system_note"),
        isNotNull(messages.body),
        sql`${waAt} > ${new Date(now.getTime() - UNANSWERED_WINDOW_MS).toISOString()}::timestamp`,
      ),
    )
    .orderBy(desc(waAt))
    .limit(UNANSWERED_LOOKBACK_ROWS);
  return rows.find((r) => r.body && asksSomething(r.body))?.body ?? null;
}

// TODA la conversación en orden cronológico (historial del cerebro), sin tope de
// mensajes. Sin los salientes FALLIDOS: el cliente nunca los recibió y el modelo no
// debe creer que sí. Se lee por páginas desde lo más reciente y solo se deja de leer
// cuando ya no cabría en el modelo (MAX_HISTORY_CHARS, la misma medida de
// fitHistory, que recorta lo que sobre).
export const HISTORY_PAGE_ROWS = 500;

export async function loadHistory(
  organizationId: string,
  conversationId: string,
  opts: { pageRows?: number; maxChars?: number } = {},
): Promise<MessageRow[]> {
  const pageRows = opts.pageRows ?? HISTORY_PAGE_ROWS;
  const maxChars = opts.maxChars ?? MAX_HISTORY_CHARS;
  const newestFirst: MessageRow[] = [];
  let chars = 0;
  for (;;) {
    const last = newestFirst[newestFirst.length - 1];
    // Cursor por (hora del Agente IA, created_at, id), mismo orden que la consulta. Se lee
    // de la fila en SQL (microsegundos exactos; un Date de JS los truncaría).
    const before = last
      ? sql`(${agentAt}, ${messages.createdAt}, ${messages.id}) < (select ${agentAtSql("c")}, c.created_at, c.id from ${messages} c where c.id = ${last.id})`
      : undefined;
    const page = await db
      .select()
      .from(messages)
      // Sin avisos internos: los lee el vendedor, no el cliente, y el modelo no
      // debe tomarlos como frases suyas.
      .where(
        and(
          inConversation(organizationId, conversationId),
          ne(messages.status, "failed"),
          ne(messages.type, "system_note"),
          // Avisos "no disponible" ocultos (en verificación o sombra): no son mensajes.
          not(hiddenNoticeSql(messages.metadata)),
          before,
        ),
      )
      .orderBy(desc(agentAt), desc(messages.createdAt), desc(messages.id))
      .limit(pageRows);
    // El confirmado sin contenido se lee como lo que es, no como "[Unsupported message]".
    for (const m of page) if (noDisponibleEstado(m.metadata) === "sin_contenido") m.body = UNAVAILABLE_HISTORY_NOTE;
    newestFirst.push(...page);
    for (const m of page) chars += messageText(m).length;
    if (page.length < pageRows || chars > maxChars) break;
  }
  return newestFirst.reverse();
}

// Salientes HUMANOS (CRM o celular) que no fallaron: si el conteo crece mientras el
// agente envía, un vendedor tomó el hilo y el agente se detiene (antes de cada burbuja).
export async function humanOutboundCount(organizationId: string, conversationId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "out"),
        inArray(messages.source, ["crm", "business_app"]),
        ne(messages.status, "failed"),
        ne(messages.type, "system_note"),
      ),
    );
  return value;
}

// ¿Hay un saliente del agente en camino ("queued") o un plan de burbujas todavía
// "enviando"? Entonces el agente no responde encima (y la conciliación del plan no
// se mezcla con otra respuesta). Un envío FALLIDO ya no frena al agente: el barrido
// deja un aviso al vendedor (23-sep-2026: el agente siempre contesta).
// `exceptIds`: burbujas de la respuesta guardada que se va a reenviar (parte 1): su fila
// "queued" no es un envío en camino, la retoma el reenvío con su misma clave.
export async function agentSendUnresolved(organizationId: string, conversationId: string, exceptIds: readonly string[] = []): Promise<boolean> {
  const [plan] = await db
    .select({ id: aiAgentDrafts.id })
    .from(aiAgentDrafts)
    .where(
      and(
        eq(aiAgentDrafts.organizationId, organizationId),
        eq(aiAgentDrafts.conversationId, conversationId),
        eq(aiAgentDrafts.status, "enviando"),
      ),
    )
    .limit(1);
  if (plan) return true;
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "out"),
        eq(messages.source, "ai_agent"),
        eq(messages.status, "queued"),
        // Un archivo de un workflow por palabra clave en camino no frena al agente; el último
        // mensaje de uno «es la respuesta» (contesta su disparador) sí.
        sql`(${closesPending} or coalesce(${messages.metadata} ? 'contestaA', false))`,
        exceptIds.length ? notInArray(messages.id, [...exceptIds]) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

// Freno ante contestadores automáticos (contestador.ts): los últimos mensajes del chat en el
// orden del Agente IA, con lo mínimo para contar vueltas. 60 filas = unas 20 vueltas, de sobra
// para saber si un texto ya se había mandado. Vendedor = la misma regla que el semáforo
// (celular, o CRM con usuario; un workflow sin usuario no es una persona).
export const LOOP_WINDOW_ROWS = 60;

export async function loopWindow(organizationId: string, conversationId: string, cut: Date | null): Promise<LoopMessage[]> {
  const rows = await db
    .select({
      direction: messages.direction,
      source: messages.source,
      sentByUserId: messages.sentByUserId,
      body: messages.body,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        ne(messages.status, "failed"),
        ne(messages.type, "system_note"),
        not(hiddenNoticeSql(messages.metadata)),
      ),
    )
    .orderBy(desc(agentAt), desc(messages.createdAt), desc(messages.id))
    .limit(LOOP_WINDOW_ROWS);
  return rows.reverse().map((m) => ({
    direction: m.direction,
    human: m.source === "business_app" || (m.source === "crm" && m.sentByUserId !== null),
    body: m.body,
    unreadable: isUnavailableNotice(m.metadata),
    afterCut: cut === null || m.createdAt > cut,
  }));
}

// Total de entrantes: si crece entre leer y enviar, llegó algo nuevo (revisión
// antes de enviar). Los mensajes no se borran, así que el conteo solo sube. El
// historial que el importador copia en ese momento no es "algo nuevo" del cliente.
export async function inboundCount(organizationId: string, conversationId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(messages)
    .where(and(inConversation(organizationId, conversationId), eq(messages.direction, "in"), isNull(messages.importedAt)));
  return value;
}

/**
 * Complemento de un workflow «es la respuesta» que pidió el propio Agente IA (9-oct-2026: primero
 * solo archivos, «Dónde medir»; el mismo día también con textos, «Entrada mayor a 2.5 m»): la
 * respuesta que lo pidió ya dejó su resultado final en ai_usage, pero el mensaje sigue esperando la
 * revisión del agente. ¿Va en camino esa corrida, o ya salió su último mensaje con la marca de
 * revisión (`revisaDesde`)? Mientras sea así, el resultado anterior no cuenta como «ya atendido»
 * (run.ts): el agente espera a la corrida y luego revisa el mensaje.
 * (Si el mensaje sigue pendiente con esa marca, pendingInbound ya sabe que no se ha revisado.)
 */
export async function awaitingWorkflowReview(organizationId: string, conversationId: string, messageId: string): Promise<boolean> {
  const rows = await db.execute<{ one: number }>(sql`
    select 1 as one from messages a
    where a.organization_id = ${organizationId} and a.conversation_id = ${conversationId}
      and a.direction = 'out' and a.status <> 'failed'
      and a.metadata->>'contestaA' = ${messageId} and coalesce(a.metadata ? 'revisaDesde', false)
    union all
    select 1 as one from workflow_runs r
    join workflows w on w.id = r.workflow_id and w.organization_id = r.organization_id
    where r.organization_id = ${organizationId} and r.conversation_id = ${conversationId}
      and r.trigger = 'agent' and r.trigger_message_id = ${messageId}
      and r.status in ('queued', 'running') and w.is_answer
    limit 1
  `);
  return rows.length > 0;
}

// Idempotencia: ¿este entrante ya tiene un resultado final del agente? Un
// borrador generado para él también cuenta (aunque su fila de ai_usage no se
// haya podido guardar): así el barrido no lo regenera cada minuto.
export async function alreadyHandled(organizationId: string, messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiUsage.id })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(aiUsage.messageId, messageId),
        inArray(aiUsage.outcome, [...FINAL_OUTCOMES]),
      ),
    )
    .limit(1);
  if (row) return true;
  const [draft] = await db
    .select({ id: aiAgentDrafts.id })
    .from(aiAgentDrafts)
    .where(
      and(
        eq(aiAgentDrafts.organizationId, organizationId),
        eq(aiAgentDrafts.triggerMessageId, messageId),
        // Un plan de envío que quedó obsoleto (la 1ª burbuja falló) no cuenta: se reintenta.
        ne(aiAgentDrafts.status, "obsoleto"),
      ),
    )
    .limit(1);
  return Boolean(draft);
}

// Llegada del último entrante que el agente ya atendió (respuesta, borrador,
// salto del filtro o transferencia): corte del debounce. Recorre los entrantes
// del más nuevo al más viejo y se detiene en el primero atendido.
export async function lastHandledInboundAt(organizationId: string, conversationId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "in"),
        sql`(exists (select 1 from ${aiUsage} u where u.organization_id = ${organizationId}
              and u.message_id = ${messages.id}
              and u.outcome in (${sql.join(FINAL_OUTCOMES.map((o) => sql`${o}`), sql`, `)}))
            or exists (select 1 from ${aiAgentDrafts} d where d.organization_id = ${organizationId}
              and d.trigger_message_id = ${messages.id} and d.status <> 'obsoleto'))`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

// Hora (WhatsApp) de un mensaje ya cargado.
export function messageAt(m: Pick<MessageRow, "sentAt" | "createdAt">): Date {
  return m.sentAt ?? m.createdAt;
}
