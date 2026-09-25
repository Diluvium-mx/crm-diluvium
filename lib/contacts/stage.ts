// Etapas del Embudo y la ÚNICA forma de moverlas desde el CRM o el agente
// (Fase D reestructurada, 24-sep-2026): Inbox → Prospecto → Interesado → Cerca de
// compra → Compra. Solo hacia adelante; hacia atrás o a la misma etapa se ignora
// sin error. La etapa puesta a mano por un vendedor manda: el agente nunca la
// regresa; solo puede avanzarla después por algo nuevo del chat.
// Multi-tenant: toda escritura filtra por organization_id.
import { and, eq, or, lte, ne, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { onContactStageEntered } from "@/lib/workflows/triggers";

import { isForward, type Stage, type StageChangedBy } from "./stages";

export { isForward, isStage, STAGES, type Stage, type StageChangedBy } from "./stages";

/**
 * Avanza la etapa del contacto si `to` está más adelante que la actual. Devuelve
 * la etapa anterior si se movió, o null si se ignoró (misma etapa, retroceso o
 * contacto de otra organización). Dispara lo mismo que un cambio manual: los
 * workflows "al entrar a esta etapa" (aislados; nunca rompen el cambio).
 * Idempotente: repetir la misma llamada no vuelve a mover ni a disparar.
 */
export async function moveStageForward(input: {
  organizationId: string;
  contactId: string;
  to: Stage;
  by: StageChangedBy;
  now?: Date;
  /**
   * Momento en que se basa la decisión (llegada del primer entrante del lote o
   * creación de la corrida). Si un VENDEDOR movió la etapa a mano DESPUÉS de eso,
   * manda el vendedor: el agente no la "corrige"; solo la avanza por algo nuevo.
   */
  since?: Date;
  /** Disparar los workflows "al entrar a esta etapa" (default true). */
  fireStageTriggers?: boolean;
  /** Workflows que ya salen en la misma respuesta: no se repiten por etapa. */
  excludeWorkflowIds?: readonly string[];
}): Promise<{ from: Stage } | null> {
  const now = input.now ?? new Date();
  // El CAS puede perder contra otro avance concurrente: se reintenta mientras el
  // destino siga siendo "hacia adelante".
  for (let attempt = 0; attempt < 3; attempt++) {
    const moved = await tryMove(input, now);
    if (moved !== "retry") return moved;
  }
  return null;
}

async function tryMove(input: Parameters<typeof moveStageForward>[0], now: Date): Promise<{ from: Stage } | null | "retry"> {
  const [current] = await db
    .select({ stage: contacts.stage, by: contacts.stageChangedBy, at: contacts.stageChangedAt })
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.organizationId, input.organizationId)))
    .limit(1);
  if (!current || !isForward(current.stage, input.to)) return null;
  if (input.since && current.by === "vendedor" && current.at > input.since) return null;
  // Optimista: solo si nadie la movió entre la lectura y la escritura (y la
  // condición del vendedor se repite en SQL por si cambió justo ahora).
  const vendedorManda = input.since
    ? or(isNull(contacts.stageChangedBy), ne(contacts.stageChangedBy, "vendedor"), lte(contacts.stageChangedAt, input.since))
    : sql`true`;
  const [row] = await db
    .update(contacts)
    .set({ stage: input.to, stageChangedAt: now, stageChangedBy: input.by })
    .where(and(eq(contacts.id, input.contactId), eq(contacts.organizationId, input.organizationId), eq(contacts.stage, current.stage), vendedorManda))
    .returning({ id: contacts.id });
  if (!row) return "retry";
  if (input.fireStageTriggers !== false) {
    await onContactStageEntered({
      organizationId: input.organizationId,
      contactId: input.contactId,
      stage: input.to,
      userId: null,
      excludeWorkflowIds: input.excludeWorkflowIds,
      // Una etapa movida por el agente dispara corridas "agent" (releen el estado
      // del agente y su media no cierra los pendientes), no "stage" (humanas).
      by: input.by,
    });
  }
  return { from: current.stage };
}
