// Lecturas de BD del runtime del agente: la conversación y su canal, los
// entrantes pendientes, el contexto, y los conteos del freno anti-bucle.
// Multi-tenant (CLAUDE.md §7): TODA lectura filtra por organization_id, además
// del id. Un id de otra organización no encuentra nada (defensa en profundidad:
// los ids vienen de la cola interna, pero nunca se confía en ellos solos).
import { and, count, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, aiUsage, channels, conversations, messages } from "@/lib/db/schema";
import { FINAL_OUTCOMES, REPLY_OUTCOMES } from "./usage";

export type ConversationRow = typeof conversations.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

// Hora del mensaje según WhatsApp (sent_at) o, si falta, cuándo se guardó.
const waAt = sql`coalesce(${messages.sentAt}, ${messages.createdAt})`;

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

// Último saliente que salió o va en camino (un envío FALLIDO no le respondió al
// cliente, así que no cierra los pendientes).
export async function lastOutbound(organizationId: string, conversationId: string): Promise<MessageRow | null> {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(inConversation(organizationId, conversationId), eq(messages.direction, "out"), ne(messages.status, "failed")))
    .orderBy(desc(waAt), desc(messages.createdAt))
    .limit(1);
  return row ?? null;
}

// Entrantes posteriores al último saliente (lo que el agente debe atender), en
// orden cronológico. Se compara en SQL para no perder microsegundos en JS. Solo
// los MAX_PENDING más recientes: un remitente que manda miles de mensajes (spam,
// nunca hay saliente) no vuelve cuadrático el trabajo de cada entrante.
export const MAX_PENDING = 50;

export async function pendingInbound(organizationId: string, conversationId: string): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        inConversation(organizationId, conversationId),
        eq(messages.direction, "in"),
        sql`${waAt} > coalesce((
          select max(coalesce(o.sent_at, o.created_at)) from messages o
          where o.organization_id = ${organizationId} and o.conversation_id = ${conversationId}
            and o.direction = 'out' and o.status <> 'failed'
        ), '-infinity'::timestamp)`,
      ),
    )
    .orderBy(desc(waAt), desc(messages.createdAt))
    .limit(MAX_PENDING);
  return rows.reverse();
}

// Los últimos `n` mensajes en orden cronológico (contexto del cerebro). Sin los
// salientes FALLIDOS: el cliente nunca los recibió y el modelo no debe creer que sí.
export async function recentMessages(organizationId: string, conversationId: string, n: number): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(inConversation(organizationId, conversationId), ne(messages.status, "failed")))
    .orderBy(desc(waAt), desc(messages.createdAt))
    .limit(Math.max(1, n));
  return rows.reverse();
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
      ),
    );
  return value;
}

// Total de entrantes: si crece entre leer y enviar, llegó algo nuevo (revisión
// antes de enviar). Los mensajes no se borran, así que el conteo solo sube.
export async function inboundCount(organizationId: string, conversationId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(messages)
    .where(and(inConversation(organizationId, conversationId), eq(messages.direction, "in")));
  return value;
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
    .where(and(eq(aiAgentDrafts.organizationId, organizationId), eq(aiAgentDrafts.triggerMessageId, messageId)))
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
              and d.trigger_message_id = ${messages.id}))`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

// Respuestas del agente (enviadas o en borrador) en esta conversación desde `since`.
export async function agentRepliesSince(organizationId: string, conversationId: string, since: Date): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(aiUsage.conversationId, conversationId),
        eq(aiUsage.stage, "cerebro"),
        inArray(aiUsage.outcome, [...REPLY_OUTCOMES]),
        gte(aiUsage.createdAt, since),
      ),
    );
  return value;
}

// Llamadas COBRADAS al modelo en esta conversación desde `since` (filtro y
// cerebro, incluidas las descartadas). Un error sin tokens (proveedor caído) no
// cuenta: no costó y no debe pausar al agente.
export async function modelCallsSince(organizationId: string, conversationId: string, since: Date): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(aiUsage.conversationId, conversationId),
        isNotNull(aiUsage.inputTokens),
        gte(aiUsage.createdAt, since),
      ),
    );
  return value;
}

// Gasto (USD) de la organización desde `since`. Un modelo sin precio (cost_usd
// null) no suma: el catálogo trae precio para todos los modelos del runtime.
export async function orgSpendSince(organizationId: string, since: Date): Promise<number> {
  const [{ value }] = await db
    .select({ value: sql<string | null>`sum(${aiUsage.costUsd})` })
    .from(aiUsage)
    .where(and(eq(aiUsage.organizationId, organizationId), gte(aiUsage.createdAt, since)));
  return Number(value ?? 0);
}

// Respuestas del agente a un contacto en todas sus conversaciones (tope opcional).
export async function agentRepliesToContact(organizationId: string, contactId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(aiUsage)
    .innerJoin(conversations, eq(conversations.id, aiUsage.conversationId))
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(conversations.organizationId, organizationId),
        eq(conversations.contactId, contactId),
        eq(aiUsage.stage, "cerebro"),
        inArray(aiUsage.outcome, [...REPLY_OUTCOMES]),
      ),
    );
  return value;
}

// Hora (WhatsApp) de un mensaje ya cargado.
export function messageAt(m: Pick<MessageRow, "sentAt" | "createdAt">): Date {
  return m.sentAt ?? m.createdAt;
}
