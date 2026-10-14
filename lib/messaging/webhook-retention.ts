// Retención de webhook_events PROCESADOS y en CUARENTENA (docs/backups.md, «Retención de datos
// crudos»). El payload crudo trae datos del cliente (teléfono, nombre, texto, URLs de media); ya
// aplicado a las tablas del CRM solo sirve para reprocesar o depurar.
// Procesados: 7 días (14-oct-2026, auditoría F1: con 30 días la tabla llegaba a ~200 MB y el disco
// de Postgres, de 500 MB, se llenaba). Cuarentena: 30 días (cuenta ajena a este entorno; si en 30
// días nadie la liberó, no era de aquí). El dead-letter tiene su propia regla (dead-letter-retention.ts).
// Se borra por tandas: la primera pasada tras el cambio quita ~3 semanas de eventos y una sola
// sentencia enorme llenaría el WAL justo cuando falta disco. El barrido corre cada minuto.
import { and, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";

export const PROCESSED_RETENTION_DAYS = 7;
export const QUARANTINE_RETENTION_DAYS = 30;
export const PURGE_BATCH = 2_000;

const before = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Borra UNA tanda de procesados de más de 7 días. Devuelve cuántos. */
export async function purgeExpiredProcessed(now: Date, batch: number = PURGE_BATCH): Promise<number> {
  const expired = db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(isNotNull(webhookEvents.processedAt), lt(webhookEvents.processedAt, before(now, PROCESSED_RETENTION_DAYS))))
    .limit(batch);
  const purged = await db.delete(webhookEvents).where(inArray(webhookEvents.id, expired)).returning({ id: webhookEvents.id });
  return purged.length;
}

/** Borra UNA tanda de eventos en cuarentena de más de 30 días. Devuelve cuántos. */
export async function purgeExpiredQuarantine(now: Date, batch: number = PURGE_BATCH): Promise<number> {
  const expired = db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(isNotNull(webhookEvents.quarantinedAt), lt(webhookEvents.quarantinedAt, before(now, QUARANTINE_RETENTION_DAYS))))
    .limit(batch);
  const purged = await db.delete(webhookEvents).where(inArray(webhookEvents.id, expired)).returning({ id: webhookEvents.id });
  return purged.length;
}
