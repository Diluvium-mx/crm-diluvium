// El cliente contestó un seguimiento (docs/seguimientos.md §7.2 y §7.4, decisión del dueño 2-oct-2026):
//   - si el Agente IA estaba en pausa AUTOMÁTICA (un vendedor contestó o pidió un asesor), la
//     conversación sigue con el Agente IA: se quita la pausa (opción B). La pausa puesta a mano, o la
//     del freno ante contestadores automáticos, solo se quita si el vendedor eligió «Que salga solo»;
//   - el Agente IA contesta sabiendo por qué le escribimos (línea de contexto).
// Solo cuentan los seguimientos que de verdad le llegaron (modo real). Toda consulta filtra por organización.
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, followUps } from "@/lib/db/schema";
import { agentStateLabel } from "@/lib/historial/labels";
import { chatSubject, logChanges } from "@/lib/historial/log";
import { manualPauseOf, realAttempts } from "./store";

const RECENT_MS = 3 * 24 * 60 * 60_000;

/** El seguimiento más reciente de este chat que le llegó al cliente (abierto o recién contestado). */
async function lastSentFollowUp(organizationId: string, conversationId: string, now: Date) {
  const rows = await db
    .select()
    .from(followUps)
    .where(
      and(
        eq(followUps.organizationId, organizationId),
        eq(followUps.conversationId, conversationId),
        inArray(followUps.status, ["programado", "esperando", "contestado"]),
        sql`${followUps.updatedAt} > ${new Date(now.getTime() - RECENT_MS).toISOString()}::timestamp`,
      ),
    )
    .orderBy(desc(followUps.updatedAt))
    .limit(3);
  return rows.find((r) => realAttempts(r).length > 0) ?? null;
}

/**
 * Antes de decidir si el Agente IA contesta un entrante: si contesta a un seguimiento que salió con el
 * Agente IA en pausa automática, se quita la pausa. El corte queda en la hora del seguimiento, así este
 * mensaje del cliente (posterior) sí se contesta. Devuelve si reactivó.
 */
export async function resumeAgentOnFollowUpReply(organizationId: string, conversationId: string, wrote: Date | null, now: Date): Promise<boolean> {
  const [conv] = await db
    .select({ state: conversations.agentState, until: conversations.agentPausedUntil, changedAt: conversations.agentStateChangedAt })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conv || conv.state !== "pausado_humano") return false;
  const row = await lastSentFollowUp(organizationId, conversationId, now);
  if (!row || row.status === "contestado") return false;
  const sent = realAttempts(row);
  const lastSent = new Date(sent[sent.length - 1].at);
  if (wrote && wrote.getTime() <= lastSent.getTime()) return false;
  // La pausa se puso DESPUÉS del seguimiento (un vendedor escribió): manda el vendedor.
  if (conv.changedAt && conv.changedAt.getTime() > lastSent.getTime()) return false;
  if ((await manualPauseOf(organizationId, conversationId, conv.state, conv.changedAt)) && !row.autoAprobado) return false;
  return db.transaction(async (tx) => {
    const own = and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId));
    const done = await tx
      .update(conversations)
      .set({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: lastSent })
      .where(and(own, ne(conversations.agentState, "activo")))
      .returning({ id: conversations.id });
    if (done.length === 0) return false;
    await logChanges(tx, {
      organizationId,
      userId: null,
      kind: "pausas",
      action: "vuelta_seguimiento",
      subject: chatSubject(organizationId, conversationId),
      subjectId: conversationId,
      oldValue: agentStateLabel("pausado_humano", conv.until),
      newValue: agentStateLabel("activo", null),
    });
    return true;
  });
}

/** Línea para el contexto del Agente IA cuando el cliente contesta un seguimiento (o está por hacerlo). */
export async function followUpContextFor(organizationId: string, conversationId: string, now: Date = new Date()): Promise<string> {
  const row = await lastSentFollowUp(organizationId, conversationId, now);
  if (!row) return "";
  const parts = [`[SEGUIMIENTO] Le escribimos al cliente un seguimiento por: «${row.pendiente ?? "lo que quedó pendiente"}».`];
  if (row.siguientePaso) parts.push(`Lo que buscamos: «${row.siguientePaso}».`);
  parts.push("Si contesta, retoma justo eso, sin repetir lo que ya se le dijo.");
  return parts.join(" ");
}
