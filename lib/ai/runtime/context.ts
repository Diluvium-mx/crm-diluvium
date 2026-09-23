// Lecturas de BD del runtime del agente: la conversación y su canal, los
// entrantes pendientes, el contexto, y los conteos del freno anti-bucle.
import { and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage, channels, conversations, messages } from "@/lib/db/schema";
import { FINAL_OUTCOMES, REPLY_OUTCOMES } from "./usage";

export type ConversationRow = typeof conversations.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

// Hora del mensaje según WhatsApp (sent_at) o, si falta, cuándo se guardó.
const waAt = sql`coalesce(${messages.sentAt}, ${messages.createdAt})`;

export async function loadSnapshot(
  conversationId: string,
): Promise<{ conversation: ConversationRow; channel: ChannelRow } | null> {
  const [row] = await db
    .select({ conversation: conversations, channel: channels })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row ?? null;
}

// Último saliente que salió o va en camino (un envío FALLIDO no le respondió al
// cliente, así que no cierra los pendientes).
export async function lastOutbound(conversationId: string): Promise<MessageRow | null> {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "out"), ne(messages.status, "failed")))
    .orderBy(desc(waAt), desc(messages.createdAt))
    .limit(1);
  return row ?? null;
}

// Entrantes posteriores al último saliente (lo que el agente debe atender), en
// orden cronológico. Se compara en SQL para no perder microsegundos en JS.
export async function pendingInbound(conversationId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "in"),
        sql`${waAt} > coalesce((
          select max(coalesce(o.sent_at, o.created_at)) from messages o
          where o.conversation_id = ${conversationId} and o.direction = 'out' and o.status <> 'failed'
        ), '-infinity'::timestamp)`,
      ),
    )
    .orderBy(asc(waAt), asc(messages.createdAt));
}

// Los últimos `n` mensajes en orden cronológico (contexto del cerebro).
export async function recentMessages(conversationId: string, n: number): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(waAt), desc(messages.createdAt))
    .limit(Math.max(1, n));
  return rows.reverse();
}

// Total de entrantes: si crece entre leer y enviar, llegó algo nuevo (revisión
// antes de enviar). Los mensajes no se borran, así que el conteo solo sube.
export async function inboundCount(conversationId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in")));
  return value;
}

// Idempotencia: ¿este entrante ya tiene un resultado final del agente?
export async function alreadyHandled(messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiUsage.id })
    .from(aiUsage)
    .where(and(eq(aiUsage.messageId, messageId), inArray(aiUsage.outcome, [...FINAL_OUTCOMES])))
    .limit(1);
  return Boolean(row);
}

// Respuestas del agente (enviadas o en borrador) en esta conversación desde `since`.
export async function agentRepliesSince(conversationId: string, since: Date): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.conversationId, conversationId),
        eq(aiUsage.stage, "cerebro"),
        inArray(aiUsage.outcome, [...REPLY_OUTCOMES]),
        gte(aiUsage.createdAt, since),
      ),
    );
  return value;
}

// Respuestas del agente a un contacto en todas sus conversaciones (tope opcional).
export async function agentRepliesToContact(contactId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(aiUsage)
    .innerJoin(conversations, eq(conversations.id, aiUsage.conversationId))
    .where(
      and(
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
