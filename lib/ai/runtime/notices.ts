// Avisos del agente para el vendedor, dentro del hilo. Sustituyen a la tarjeta de
// borrador, a la pausa y a las etiquetas de "revisión humana" / "pasar a humano":
// el agente SIEMPRE contesta y solo deja rastro (23-sep-2026). Nunca lanzan: un
// aviso que no se pudo guardar no debe frenar una respuesta al cliente.
// Multi-tenant (CLAUDE.md §7): toda lectura/escritura filtra por organization_id.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentNotices, conversations } from "@/lib/db/schema";
import type { NoticeKind } from "./policy";
import { notifyConversation } from "./state";

export type { NoticeKind };

// Un aviso de frenos (anti-bucle, presupuesto, tope) se repite como máximo una vez
// por hora y conversación: el barrido reprograma cada minuto un entrante sin atender.
export const NOTICE_REPEAT_MINUTES = 60;

export async function addNotice(input: {
  organizationId: string;
  conversationId: string;
  kind: NoticeKind;
  body: string;
  now: Date;
  // Saliente del agente al que se refiere: un aviso por mensaje y tipo.
  messageId?: string | null;
  // No repetir si ya hay uno del mismo tipo en esta ventana.
  dedupeMinutes?: number;
}): Promise<boolean> {
  try {
    const own = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)))
      .limit(1);
    if (own.length === 0) return false;
    if (input.dedupeMinutes) {
      const since = new Date(input.now.getTime() - input.dedupeMinutes * 60_000);
      const [recent] = await db
        .select({ id: aiAgentNotices.id })
        .from(aiAgentNotices)
        .where(
          and(
            eq(aiAgentNotices.organizationId, input.organizationId),
            eq(aiAgentNotices.conversationId, input.conversationId),
            eq(aiAgentNotices.kind, input.kind),
            gte(aiAgentNotices.createdAt, since),
          ),
        )
        .limit(1);
      if (recent) return false;
    }
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
