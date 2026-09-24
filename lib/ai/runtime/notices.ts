// Avisos del agente para el vendedor, dentro del hilo de la Bandeja: el cliente
// pidió hablar con una persona (el agente sigue activo hasta que un vendedor
// conteste) o WhatsApp no confirmó/rechazó una respuesta del agente. Nunca pausan
// ni frenan al agente, y nunca lanzan: un aviso que no se pudo guardar no debe
// frenar una respuesta al cliente.
// Multi-tenant (CLAUDE.md §7): toda lectura/escritura filtra por organization_id.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentNotices, conversations } from "@/lib/db/schema";
import type { NoticeKind } from "./policy";
import { notifyConversation } from "./state";

export type { NoticeKind };

export async function addNotice(input: {
  organizationId: string;
  conversationId: string;
  kind: NoticeKind;
  body: string;
  // Saliente del agente al que se refiere: un aviso por mensaje y tipo.
  messageId?: string | null;
}): Promise<boolean> {
  try {
    const own = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)))
      .limit(1);
    if (own.length === 0) return false;
    const rows = await db
      .insert(aiAgentNotices)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        kind: input.kind,
        body: input.body.slice(0, 1_000),
      })
      .onConflictDoNothing()
      .returning({ id: aiAgentNotices.id });
    if (rows.length > 0) await notifyConversation(db, input.organizationId, input.conversationId);
    return rows.length > 0;
  } catch (error) {
    console.error(`[agente] no se pudo guardar el aviso "${input.kind}" en ${input.conversationId}`, error);
    return false;
  }
}

export type NoticeRow = { id: string; kind: string; body: string; createdAt: Date };

// Los avisos más recientes de la conversación, en orden cronológico (para el hilo).
export async function loadNotices(organizationId: string, conversationId: string, limit = 50): Promise<NoticeRow[]> {
  const rows = await db
    .select({ id: aiAgentNotices.id, kind: aiAgentNotices.kind, body: aiAgentNotices.body, createdAt: aiAgentNotices.createdAt })
    .from(aiAgentNotices)
    .where(and(eq(aiAgentNotices.organizationId, organizationId), eq(aiAgentNotices.conversationId, conversationId)))
    .orderBy(desc(aiAgentNotices.createdAt), desc(sql`${aiAgentNotices.id}`))
    .limit(limit);
  return rows.reverse();
}

// Aviso de pase a humano ANTES de enviar la respuesta, idempotente por el entrante
// que la disparó (índice único message_id+kind): si el worker cae a la mitad o la
// cola reintenta, no se pierde ni se duplica. A diferencia de addNotice, LANZA si
// la BD falla: la corrida se reintenta antes de decirle al cliente que lo atenderán.
export async function ensureHandoverNotice(input: { organizationId: string; conversationId: string; triggerMessageId: string }): Promise<void> {
  const rows = await db
    .insert(aiAgentNotices)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: input.triggerMessageId,
      kind: "pasar_a_humano",
      body: "El cliente pidió hablar con un vendedor. El agente le dijo que lo atenderán y sigue contestando hasta que alguien responda.",
    })
    .onConflictDoNothing()
    .returning({ id: aiAgentNotices.id });
  if (rows.length > 0) await notifyConversation(db, input.organizationId, input.conversationId);
}
