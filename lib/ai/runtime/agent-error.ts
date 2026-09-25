// Tarjeta "El agente no pudo responder" (Fase E, "reenvío seguro", 25-sep-2026).
// Cuando el modelo falla, el runtime deja UNA tarjeta por conversación sin atender
// (kind "agente_error") y ya no vuelve a llamar al modelo en esa conversación hasta
// que un vendedor elija "Reintentar" (se vuelve a intentar una vez) o "Apagar" (se
// pausa el agente ahí; "Reactivar" lo regresa). Sin reintentos a ciegas: ni la cola
// ni el barrido la tocan mientras siga sin atender (sweep.ts).
// Multi-tenant (CLAUDE.md §7): toda lectura/escritura filtra por organization_id.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentNotices, channels, conversations } from "@/lib/db/schema";
import { notifyConversation } from "./state";

export const AGENT_ERROR_KIND = "agente_error";
// "superada": el agente volvió a contestar en la conversación (p. ej. tras "Reactivar").
export type AgentErrorResolution = "reintentar" | "apagar" | "superada";

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

// ¿Hay una tarjeta de error sin atender que BLOQUEE la conversación? Mientras la
// haya, el agente no llama al modelo ahí (ni con mensajes nuevos del cliente). Solo
// bloquea si es POSTERIOR al último cambio de estado del agente en la conversación
// (pausa, "Reactivar") y al último encendido del canal: un vendedor que contestó a
// mano y luego reactivó ya decidió; la tarjeta vieja no lo deja callado. La misma
// regla usa el barrido (sweep.ts).
export async function hasUnresolvedAgentError(organizationId: string, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiAgentNotices.id })
    .from(aiAgentNotices)
    .innerJoin(conversations, and(eq(conversations.id, aiAgentNotices.conversationId), eq(conversations.organizationId, organizationId)))
    .innerJoin(channels, and(eq(channels.id, conversations.channelId), eq(channels.organizationId, organizationId)))
    .where(
      and(
        eq(aiAgentNotices.organizationId, organizationId),
        eq(aiAgentNotices.conversationId, conversationId),
        eq(aiAgentNotices.kind, AGENT_ERROR_KIND),
        isNull(aiAgentNotices.resolvedAt),
        sql`${aiAgentNotices.createdAt} > coalesce(${conversations.agentStateChangedAt}, '-infinity'::timestamp)`,
        sql`${aiAgentNotices.createdAt} > coalesce(${channels.aiAgentModeChangedAt}, '-infinity'::timestamp)`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

// El agente volvió a contestar: las tarjetas abiertas de la conversación quedan
// "superadas" (dejan de mostrar botones). Nunca lanza: es solo limpieza de la vista.
export async function supersedeAgentErrors(organizationId: string, conversationId: string): Promise<void> {
  try {
    const rows = await db
      .update(aiAgentNotices)
      .set({ resolvedAt: sql`now()`, resolution: "superada" })
      .where(
        and(
          eq(aiAgentNotices.organizationId, organizationId),
          eq(aiAgentNotices.conversationId, conversationId),
          eq(aiAgentNotices.kind, AGENT_ERROR_KIND),
          isNull(aiAgentNotices.resolvedAt),
        ),
      )
      .returning({ id: aiAgentNotices.id });
    if (rows.length) await notifyConversation(db, organizationId, conversationId);
  } catch (error) {
    console.error(`[agente] no se pudieron cerrar las tarjetas de error de ${conversationId}`, error);
  }
}

// "Reintentar" no pudo programar la corrida (cola caída): la tarjeta vuelve a quedar
// abierta para que el vendedor lo intente de nuevo (no queda nadie a cargo).
export async function reopenAgentError(organizationId: string, noticeId: string): Promise<void> {
  await db
    .update(aiAgentNotices)
    .set({ resolvedAt: null, resolution: null, resolvedByUserId: null })
    .where(and(eq(aiAgentNotices.id, noticeId), eq(aiAgentNotices.organizationId, organizationId), eq(aiAgentNotices.resolution, "reintentar")));
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

// Conversación de una tarjeta de error ABIERTA de la organización (o null).
export async function openAgentErrorConversation(organizationId: string, noticeId: string): Promise<string | null> {
  const [row] = await db
    .select({ conversationId: aiAgentNotices.conversationId })
    .from(aiAgentNotices)
    .where(
      and(
        eq(aiAgentNotices.id, noticeId),
        eq(aiAgentNotices.organizationId, organizationId),
        eq(aiAgentNotices.kind, AGENT_ERROR_KIND),
        isNull(aiAgentNotices.resolvedAt),
      ),
    )
    .limit(1);
  return row?.conversationId ?? null;
}
