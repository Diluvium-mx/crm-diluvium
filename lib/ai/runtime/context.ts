// Lecturas de BD del runtime del agente: la conversación y su canal, los
// entrantes pendientes, el historial completo y la idempotencia.
// Multi-tenant (CLAUDE.md §7): TODA lectura filtra por organization_id, además
// del id. Un id de otra organización no encuentra nada (defensa en profundidad:
// los ids vienen de la cola interna, pero nunca se confía en ellos solos).
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, aiUsage, channels, conversations, messages } from "@/lib/db/schema";
import { FINAL_OUTCOMES } from "./usage";

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

// TODA la conversación en orden cronológico (historial del cerebro). Sin los
// salientes FALLIDOS: el cliente nunca los recibió y el modelo no debe creer que
// sí. MAX_HISTORY_ROWS es solo protección técnica de la lectura; lo que cabe en el
// modelo lo decide fitHistory (transcript.ts), quedándose con lo más reciente.
export const MAX_HISTORY_ROWS = 2_000;

export async function loadHistory(organizationId: string, conversationId: string): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(inConversation(organizationId, conversationId), ne(messages.status, "failed")))
    .orderBy(desc(waAt), desc(messages.createdAt))
    .limit(MAX_HISTORY_ROWS);
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

// ¿Hay un saliente del agente en camino ("queued") o un plan de burbujas todavía
// "enviando"? Entonces el agente no responde encima (y la conciliación del plan no
// se mezcla con otra respuesta). Un envío FALLIDO ya no frena al agente: el barrido
// deja un aviso al vendedor (23-sep-2026: el agente siempre contesta).
export async function agentSendUnresolved(organizationId: string, conversationId: string): Promise<boolean> {
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
      ),
    )
    .limit(1);
  return Boolean(row);
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
