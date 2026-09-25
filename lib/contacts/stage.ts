// Etapas del Embudo y la ÚNICA forma de moverlas desde el CRM o el agente
// (Fase D reestructurada, 24-sep-2026): Inbox → Prospecto → Interesado → Cerca de
// compra → Compra. Solo hacia adelante; hacia atrás o a la misma etapa se ignora
// sin error. La etapa puesta a mano por un vendedor manda: el agente nunca la
// regresa; solo puede avanzarla después por algo nuevo del chat.
// Multi-tenant: toda escritura filtra por organization_id.
import { and, eq } from "drizzle-orm";
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
}): Promise<{ from: Stage } | null> {
  const now = input.now ?? new Date();
  const [current] = await db
    .select({ stage: contacts.stage })
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.organizationId, input.organizationId)))
    .limit(1);
  if (!current || !isForward(current.stage, input.to)) return null;
  // Optimista: solo si nadie la movió entre la lectura y la escritura.
  const [row] = await db
    .update(contacts)
    .set({ stage: input.to, stageChangedAt: now, stageChangedBy: input.by })
    .where(and(eq(contacts.id, input.contactId), eq(contacts.organizationId, input.organizationId), eq(contacts.stage, current.stage)))
    .returning({ id: contacts.id });
  if (!row) return null;
  await onContactStageEntered({ organizationId: input.organizationId, contactId: input.contactId, stage: input.to, userId: null });
  return { from: current.stage };
}
