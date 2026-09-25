// Tarjeta "El agente no pudo responder" (Fase E, "reenvío seguro", 25-sep-2026).
// Cuando el modelo falla, el runtime deja UNA tarjeta por conversación sin atender
// (kind "agente_error") y ya no vuelve a llamar al modelo en esa conversación hasta
// que un vendedor elija "Reintentar" (se vuelve a intentar una vez) o "Apagar" (se
// pausa el agente ahí; "Reactivar" lo regresa). Sin reintentos a ciegas: ni la cola
// ni el barrido la tocan mientras siga sin atender (sweep.ts).
// Multi-tenant (CLAUDE.md §7): toda lectura/escritura filtra por organization_id.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentNotices, conversations } from "@/lib/db/schema";
import { notifyConversation } from "./state";

export const AGENT_ERROR_KIND = "agente_error";
export type AgentErrorResolution = "reintentar" | "apagar";

// Guarda (o renueva) la tarjeta del lote que falló. Un reintento que vuelve a fallar
// sobre el mismo mensaje la reabre con el error nuevo (índice único message_id+kind).
// LANZA si la BD falla: sin tarjeta, la cola reintenta (mejor que un cliente sin
// respuesta y un vendedor sin aviso).
export async function recordAgentError(input: { organizationId: string; conversationId: string; messageId: string; body: string }): Promise<void> {
  const own = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)))
    .limit(1);
  if (own.length === 0) return;
  await db
    .insert(aiAgentNotices)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      kind: AGENT_ERROR_KIND,
      body: input.body.slice(0, 1_000),
    })
    .onConflictDoUpdate({
      target: [aiAgentNotices.messageId, aiAgentNotices.kind],
      // El índice único es parcial (message_id no nulo): Postgres exige el mismo predicado.
      targetWhere: sql`${aiAgentNotices.messageId} is not null`,
      set: { body: input.body.slice(0, 1_000), createdAt: sql`now()`, resolvedAt: null, resolution: null, resolvedByUserId: null },
    });
  await notifyConversation(db, input.organizationId, input.conversationId);
}

// ¿Hay una tarjeta de error sin atender en la conversación? Mientras la haya, el
// agente no llama al modelo ahí (ni con mensajes nuevos del cliente).
export async function hasUnresolvedAgentError(organizationId: string, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiAgentNotices.id })
    .from(aiAgentNotices)
    .where(
      and(
        eq(aiAgentNotices.organizationId, organizationId),
        eq(aiAgentNotices.conversationId, conversationId),
        eq(aiAgentNotices.kind, AGENT_ERROR_KIND),
        isNull(aiAgentNotices.resolvedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// Marca la tarjeta como atendida. Devuelve la conversación si ESTA llamada la
// atendió (null si no existe, es de otra organización o ya la atendió alguien: un
// doble clic no reintenta dos veces).
export async function resolveAgentError(input: {
  organizationId: string;
  noticeId: string;
  resolution: AgentErrorResolution;
  userId: string;
}): Promise<{ conversationId: string } | null> {
  const rows = await db
    .update(aiAgentNotices)
    .set({ resolvedAt: sql`now()`, resolution: input.resolution, resolvedByUserId: input.userId })
    .where(
      and(
        eq(aiAgentNotices.id, input.noticeId),
        eq(aiAgentNotices.organizationId, input.organizationId),
        eq(aiAgentNotices.kind, AGENT_ERROR_KIND),
        isNull(aiAgentNotices.resolvedAt),
      ),
    )
    .returning({ conversationId: aiAgentNotices.conversationId });
  if (rows.length === 0) return null;
  await notifyConversation(db, input.organizationId, rows[0].conversationId);
  return rows[0];
}
