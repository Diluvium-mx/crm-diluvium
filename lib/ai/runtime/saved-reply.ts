// Respuesta GUARDADA del agente cuyo envío falló (Agente IA parte 1, 26-sep-2026).
//
// Antes, un error al enviar que no se clasificaba relanzaba el job: BullMQ lo corría
// desde cero, volvía a llamar al modelo (pagando otra vez) y el cliente podía recibir
// hasta 3 respuestas distintas (docs/anuncios.md, diagnóstico del 25-sep). Ahora:
// - cada respuesta se guarda UNA vez como plan (ai_agent_drafts) antes del 1er mensaje,
//   con ids de mensaje DETERMINISTAS por burbuja (= clave de idempotencia en Zernio);
// - si el 1er mensaje no sale (por lo que sea), el plan queda "pendiente" y el vendedor
//   ve la tarjeta "Reintentar / Apagar". "Reintentar" reenvía el MISMO texto con los
//   MISMOS ids: si Zernio sí lo había aceptado, su clave (24 h) devuelve la respuesta
//   guardada sin mandar otro mensaje. Nunca se vuelve a llamar al modelo por un error
//   de envío; "Apagar" lo descarta.
// Multi-tenant (CLAUDE.md §7): toda lectura/escritura filtra por organization_id.
import { createHash } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgentDrafts, messages } from "@/lib/db/schema";
import { agentAtSql, MAX_PENDING, type MessageRow } from "./context";

export type SavedRun = { slug: string; workflowId: string };
// Una respuesta guardada no sale después de esto (la clave de idempotencia de Zernio
// dura 24 h y la conversación ya cambió): se descarta con aviso al vendedor.
export const SAVED_REPLY_TTL_MS = 24 * 3_600_000;
export type SavedReply = {
  id: string;
  bubbles: string[];
  runs: SavedRun[];
  triggerMessageId: string | null;
  createdAt: Date;
};

// Id de la fila de `messages` (y Idempotency-Key) de la burbuja `index` del plan.
// Mismo formato que stepMessageId (lib/workflows/executor.ts): parece un uuid.
export function bubbleMessageId(planId: string, index: number): string {
  const h = createHash("sha256").update(`agent-bubble:${planId}:${index}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// El 1er mensaje del plan no salió: el plan ("enviando") queda "pendiente" hasta que
// un vendedor elija. Un "pendiente" anterior de la conversación (índice único: uno por
// conversación) queda obsoleto: solo la respuesta más nueva se puede reenviar.
export async function holdForRetry(organizationId: string, planId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select({ conversationId: aiAgentDrafts.conversationId })
      .from(aiAgentDrafts)
      .where(and(eq(aiAgentDrafts.id, planId), eq(aiAgentDrafts.organizationId, organizationId)))
      .limit(1);
    if (!plan) return false;
    await tx
      .update(aiAgentDrafts)
      .set({ status: "obsoleto" })
      .where(
        and(
          eq(aiAgentDrafts.organizationId, organizationId),
          eq(aiAgentDrafts.conversationId, plan.conversationId),
          eq(aiAgentDrafts.status, "pendiente"),
          ne(aiAgentDrafts.id, planId),
        ),
      );
    const rows = await tx
      .update(aiAgentDrafts)
      .set({ status: "pendiente" })
      .where(and(eq(aiAgentDrafts.id, planId), eq(aiAgentDrafts.organizationId, organizationId), eq(aiAgentDrafts.status, "enviando")))
      .returning({ id: aiAgentDrafts.id });
    return rows.length > 0;
  });
}

export async function loadSavedReply(organizationId: string, conversationId: string): Promise<SavedReply | null> {
  const [row] = await db
    .select({
      id: aiAgentDrafts.id,
      bubbles: aiAgentDrafts.bubbles,
      runs: aiAgentDrafts.runs,
      triggerMessageId: aiAgentDrafts.triggerMessageId,
      createdAt: aiAgentDrafts.createdAt,
    })
    .from(aiAgentDrafts)
    .where(
      and(
        eq(aiAgentDrafts.organizationId, organizationId),
        eq(aiAgentDrafts.conversationId, conversationId),
        eq(aiAgentDrafts.status, "pendiente"),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Toma la respuesta guardada para reenviarla ("pendiente" → "enviando"). false = ya
// la tomó otra corrida o la descartaron.
export async function claimSavedReply(organizationId: string, planId: string): Promise<boolean> {
  // resolved_at = ahora: el barrido de planes atorados cuenta 10 min desde el reenvío,
  // no desde la falla original (si no, podía tomarlo a la mitad del reenvío).
  const rows = await db
    .update(aiAgentDrafts)
    .set({ status: "enviando", resolvedAt: sql`now()` })
    .where(and(eq(aiAgentDrafts.id, planId), eq(aiAgentDrafts.organizationId, organizationId), eq(aiAgentDrafts.status, "pendiente")))
    .returning({ id: aiAgentDrafts.id });
  return rows.length > 0;
}

// "Apagar" en la tarjeta (o un corte posterior: "Reactivar", encender el canal): la
// respuesta guardada ya no se manda.
export async function discardSavedReplies(
  organizationId: string,
  conversationId: string,
  status: "descartado" | "obsoleto" = "descartado",
): Promise<void> {
  await db
    .update(aiAgentDrafts)
    .set({ status })
    .where(
      and(
        eq(aiAgentDrafts.organizationId, organizationId),
        eq(aiAgentDrafts.conversationId, conversationId),
        eq(aiAgentDrafts.status, "pendiente"),
      ),
    );
}

// Entrantes POSTERIORES al que se estaba atendiendo cuando la respuesta falló (el
// cliente siguió escribiendo mientras la tarjeta esperaba): tras reenviar lo guardado,
// el agente los atiende en una ronda nueva (eso sí es una llamada al modelo: son
// mensajes nuevos, no el error de envío).
export async function inboundAfter(organizationId: string, conversationId: string, messageId: string): Promise<MessageRow[]> {
  // Hora del Agente IA (context.ts, agentAtSql): un mensaje tapado por la respuesta también cuenta.
  const waAt = agentAtSql("messages");
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "in"),
        sql`(${waAt}, ${messages.createdAt}) > (select ${agentAtSql("t")}, t.created_at from ${messages} t
              where t.id = ${messageId} and t.organization_id = ${organizationId})`,
      ),
    )
    .orderBy(asc(waAt), asc(messages.createdAt))
    .limit(MAX_PENDING);
}

// «El workflow es la respuesta» por palabra clave (29-sep-2026, bug de la ráfaga): su último
// mensaje contesta SOLO el entrante que lo disparó (ANSWERS_ONLY_KEY en context.ts). Lo que el
// cliente escribió antes en la misma ráfaga ("¿Cuánto tarda el envío?" + "Precio") sigue
// pendiente para el Agente IA. Desde el 30-sep-2026 con la marca de revisión
// (ANSWERS_ONLY_REVIEW_KEY): el Agente IA revisa ese mismo mensaje y contesta lo que el workflow
// no cubrió («De que cd son y que precio tienen»).
export async function markAnswersOnly(organizationId: string, messageId: string, triggerMessageId: string): Promise<void> {
  await db.execute(sql`
    update messages set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('contestaA', ${triggerMessageId}::text, 'revisaAgente', true)
    where id = ${messageId} and organization_id = ${organizationId}
      and exists (select 1 from messages t where t.id = ${triggerMessageId} and t.organization_id = ${organizationId})
  `);
}

// La burbuja reenviada contesta solo hasta el entrante que originó la respuesta (ver
// ANSWERS_UNTIL_KEY en context.ts). La hora (la del Agente IA, agentAtSql) se copia en SQL, con microsegundos.
export async function markAnswersUntil(organizationId: string, messageId: string, triggerMessageId: string): Promise<void> {
  await db.execute(sql`
    update messages set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{respondeHasta}',
      to_jsonb((select (${agentAtSql("t")})::text from messages t where t.id = ${triggerMessageId} and t.organization_id = ${organizationId})))
    where id = ${messageId} and organization_id = ${organizationId}
      and exists (select 1 from messages t where t.id = ${triggerMessageId} and t.organization_id = ${organizationId})
  `);
}
