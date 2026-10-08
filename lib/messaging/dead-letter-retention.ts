// Retención del DEAD-LETTER de webhook_events (punto 9, 7-oct-2026; docs/backups.md,
// «Retención de datos crudos»). El payload crudo de un webhook trae datos personales
// (teléfono, nombre y texto del cliente). Un evento que agotó sus intentos se guarda para
// revisarlo y reprocesarlo (`npm run webhooks:replay`), pero no para siempre: a los 30
// días de dead_lettered_at se VACÍA su payload. La fila se queda (id, evento, intentos,
// last_error, fechas): el monitor y el barrido la siguen contando igual. Un evento vaciado
// ya no se puede reprocesar: el replay y la ingesta lo saltan con un mensaje claro.
//
// Sin migración: payload es NOT NULL, así que en su lugar queda un marcador
// `{ "_vaciado": "<fecha ISO>" }`.
import { and, eq, isNotNull, isNull, lt, not, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";

export const DEAD_LETTER_PAYLOAD_DAYS = 30;
export const EMPTIED_PAYLOAD_KEY = "_vaciado";

export const EMPTIED_PAYLOAD_NOTICE =
  `su payload se vació a los ${DEAD_LETTER_PAYLOAD_DAYS} días del dead-letter (datos personales); ya no se puede reprocesar`;

/** ¿Este payload es el marcador de uno vaciado? */
export function isEmptiedPayload(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) && EMPTIED_PAYLOAD_KEY in payload;
}

/** SQL: la fila ya tiene el payload vaciado. */
export function payloadEmptied(): SQL {
  return sql`(${webhookEvents.payload} ->> ${EMPTIED_PAYLOAD_KEY}) is not null`;
}

function ofOrganization(organizationId: string | null): SQL {
  // null: eventos que nunca se atribuyeron a una organización (p. ej. sin canal conocido).
  return organizationId === null ? isNull(webhookEvents.organizationId) : eq(webhookEvents.organizationId, organizationId);
}

function expiredDeadLetters(now: Date): SQL | undefined {
  return and(
    isNotNull(webhookEvents.deadLetteredAt),
    lt(webhookEvents.deadLetteredAt, new Date(now.getTime() - DEAD_LETTER_PAYLOAD_DAYS * 86_400_000)),
    not(payloadEmptied()),
  );
}

/** Vacía los payloads de dead-letters de más de 30 días de UNA organización. Devuelve cuántos. */
export async function emptyExpiredDeadLetterPayloads(organizationId: string | null, now: Date): Promise<number> {
  const emptied = await db
    .update(webhookEvents)
    .set({ payload: { [EMPTIED_PAYLOAD_KEY]: now.toISOString() } })
    .where(and(ofOrganization(organizationId), expiredDeadLetters(now)))
    .returning({ id: webhookEvents.id });
  return emptied.length;
}

/** Barrido del worker: organización por organización (y los eventos sin organización). */
export async function sweepExpiredDeadLetterPayloads(now: Date): Promise<number> {
  const owners = await db
    .selectDistinct({ organizationId: webhookEvents.organizationId })
    .from(webhookEvents)
    .where(expiredDeadLetters(now));
  let total = 0;
  for (const { organizationId } of owners) total += await emptyExpiredDeadLetterPayloads(organizationId, now);
  return total;
}
