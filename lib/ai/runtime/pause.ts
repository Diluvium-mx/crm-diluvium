// "Apagar bot" por conversación (25-sep-2026): el vendedor apaga al agente en UNA
// conversación por 8/12/24 h, hasta una hora exacta o hasta reactivarlo. Es la
// misma pausa que deja un vendedor al contestar (pausado_humano); lo que cambia es
// la hora de regreso (agent_paused_until; null = hasta "Reactivar"). Al vencer,
// el barrido del worker (cada minuto) lo vuelve a "activo". Toda escritura filtra
// por organización.
//
// Regla del dueño — solo mensajes nuevos: al volver, el corte
// (agent_state_changed_at) deja atrás lo que el cliente escribió durante la pausa:
// nada lo contesta solo (ni el barrido de huérfanos tras un reinicio); el agente
// responde a partir del siguiente mensaje del cliente. Con hora de regreso, el
// corte es ESA hora (la que vio el vendedor), no la del barrido: un mensaje escrito
// después siempre se puede rescatar, y uno escrito antes que llegó tarde (webhook
// retrasado) no se contesta (se compara con la hora de WhatsApp del mensaje).
//
// Historial de cambios (Bloque A, 28-sep-2026): «Pausar agente» (con quién) y la pausa
// automática "un vendedor contestó" dejan su fila en la MISMA transacción que la pausa.
// Bloque E: también las automáticas por tope de respuestas y por pedir un asesor, y la
// vuelta sola al cumplirse la hora de regreso.
import { and, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { agentStateLabel } from "@/lib/historial/labels";
import { chatSubject, logChanges } from "@/lib/historial/log";
import { bullAgentQueuePort, cancelAgentRun, withQueueTimeout, type AgentQueuePort } from "./queue";

const ownConversation = (organizationId: string, conversationId: string) =>
  and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId));

// Pausa con hora de regreso ya cumplida (la de "sin tiempo" nunca vence).
const pauseDue = (now: Date) =>
  and(eq(conversations.agentState, "pausado_humano"), isNotNull(conversations.agentPausedUntil), lte(conversations.agentPausedUntil, now));

/** ¿El bot ya debió volver? (pausa con hora cumplida que el barrido aún no reactivó). */
export function isPauseDue(c: { agentState: string; agentPausedUntil: Date | null }, now: Date): boolean {
  return c.agentState === "pausado_humano" && c.agentPausedUntil !== null && c.agentPausedUntil.getTime() <= now.getTime();
}

// Apaga el bot en la conversación hasta `until` (null = hasta "Reactivar"). Si ya
// estaba apagado, cambia la hora de regreso. Cancela el job pendiente: un mensaje
// que llegó justo antes no debe contestarse cuando el bot vuelva. Devuelve false si
// la conversación no es de la organización.
export async function pauseAgentManually(
  input: { organizationId: string; conversationId: string; until: Date | null; now: Date; userId?: string | null },
  ports: { queue?: AgentQueuePort } = {},
): Promise<boolean> {
  const own = ownConversation(input.organizationId, input.conversationId);
  const done = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ state: conversations.agentState, until: conversations.agentPausedUntil })
      .from(conversations)
      .where(own)
      .for("update");
    if (!before) return false;
    await tx.update(conversations).set({ agentState: "pausado_humano", agentPausedUntil: input.until, agentStateChangedAt: input.now }).where(own);
    await logChanges(tx, {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      kind: "pausas",
      action: "pausar",
      subject: chatSubject(input.organizationId, input.conversationId),
      subjectId: input.conversationId,
      oldValue: agentStateLabel(before.state, before.until),
      newValue: agentStateLabel("pausado_humano", input.until),
    });
    return true;
  });
  if (!done) return false;
  // La pausa ya quedó guardada: cancelar el job es solo optimización (la corrida
  // revisa el estado antes de responder y antes de cada burbuja).
  await withQueueTimeout(cancelAgentRun(ports.queue ?? bullAgentQueuePort(), input.conversationId), "cancelar").catch(
    (error) => console.error(`[agente] no se pudo cancelar el job de ${input.conversationId}: ${String(error)}`),
  );
  return true;
}

// Vuelve a "activo" una pausa con hora cumplida; el corte es la hora de regreso
// (en el UPDATE, la columna vale lo de ANTES de ponerla en null). Condicional: si
// otro vendedor la cambió o la reactivó en medio, no se pisa. Devuelve si cambió algo.
// Deja la fila "vuelta_sola" del historial (automática) en la misma transacción.
export async function reactivateDuePause(organizationId: string, conversationId: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [due] = await tx
      .select({ until: conversations.agentPausedUntil })
      .from(conversations)
      .where(and(ownConversation(organizationId, conversationId), pauseDue(now)))
      .for("update");
    if (!due) return false;
    const rows = await tx
      .update(conversations)
      .set({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: sql`${conversations.agentPausedUntil}` })
      .where(and(ownConversation(organizationId, conversationId), pauseDue(now)))
      .returning({ id: conversations.id });
    if (rows.length === 0) return false;
    await logChanges(tx, {
      organizationId,
      userId: null,
      kind: "pausas",
      action: "vuelta_sola",
      subject: chatSubject(organizationId, conversationId),
      subjectId: conversationId,
      oldValue: agentStateLabel("pausado_humano", due.until),
      newValue: agentStateLabel("activo", null),
    });
    return true;
  });
}

/**
 * Fila del historial que deja una pausa de pauseForHumanReply. Automáticas (sin autor):
 * `pausa_auto` = "un vendedor contestó", `pausa_tope` = llegó al máximo de respuestas,
 * `pausa_bucle` = parecía un contestador automático (contestador.ts), `pausa_asesor` = el
 * cliente pidió un asesor. `pausar` = la eligió una persona (p. ej.
 * «Apagar» en la tarjeta de error). Sin `log` no deja fila.
 */
export type PauseLog = { action: "pausa_auto" | "pausa_tope" | "pausa_bucle" | "pausa_asesor" } | { action: "pausar"; userId: string | null };

// Un vendedor contestó (CRM, celular, programado o comando): apaga el bot SOLO si
// estaba encendido (o su hora de regreso ya se cumplió). `until` = hora de regreso
// (Opciones del bot: "Reactivar solo después de N h", o la pausa al pedir un asesor);
// null = hasta "Activar" (fábrica). Un solo UPDATE condicional: si otro vendedor acaba
// de elegir "Apagar bot 8 h", su hora no se pisa. Devuelve si cambió algo.
export async function pauseForHumanReply(
  organizationId: string,
  conversationId: string,
  now: Date,
  until: Date | null = null,
  log?: PauseLog,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(conversations)
      .set({ agentState: "pausado_humano", agentPausedUntil: until, agentStateChangedAt: now })
      .where(and(ownConversation(organizationId, conversationId), or(eq(conversations.agentState, "activo"), pauseDue(now))))
      .returning({ id: conversations.id });
    if (rows.length === 0) return false;
    if (log) {
      await logChanges(tx, {
        organizationId,
        userId: log.action === "pausar" ? log.userId : null,
        kind: "pausas",
        action: log.action,
        subject: chatSubject(organizationId, conversationId),
        subjectId: conversationId,
        oldValue: agentStateLabel("activo", null),
        newValue: agentStateLabel("pausado_humano", until),
      });
    }
    return true;
  });
}

// Barrido del worker (cada minuto): mantenimiento de sistema sobre todas las
// organizaciones, pero cada escritura va acotada a la organización de su fila. La
// Bandeja se entera por el SSE (trigger de `conversations`, 0008).
export async function reactivateDuePauses(now: Date, limit = 200): Promise<number> {
  const due = await db
    .select({ id: conversations.id, organizationId: conversations.organizationId })
    .from(conversations)
    .where(pauseDue(now))
    .limit(limit);
  let reactivated = 0;
  for (const c of due) if (await reactivateDuePause(c.organizationId, c.id, now)) reactivated++;
  return reactivated;
}
