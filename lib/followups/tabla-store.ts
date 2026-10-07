// La tabla de seguimientos de la organización (Agente IA › Seguimientos, Parte 4; reglas en ./tabla.ts):
// lectura con caché de 60 s como máximo (el worker la usa en cada lectura y barrido; los cambios aplican
// sin redesplegar) y guardado con su fila en el Historial (change_history, tipo «seguimientos», con «Ver
// cambios»). Toda consulta filtra por organization_id; la organización la resuelve la Server Action.
// Sin "server-only": lo importa el worker (Node puro).
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, changeHistory, user } from "@/lib/db/schema";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL } from "@/lib/ai/catalog";
import { logChanges } from "@/lib/historial/log";
import { FACTORY_TABLE, tableChanges, tableFromStored, tableToStored, type FollowUpTable, type TableChange } from "./tabla";

export const FOLLOW_UP_TABLE_CACHE_MS = 60_000;

const cache = new Map<string, { at: number; table: FollowUpTable }>();

async function readTable(exec: Pick<typeof db, "select">, organizationId: string, forUpdate = false): Promise<FollowUpTable> {
  const query = exec
    .select({ casos: aiConfig.seguimientosCasos, vendedores: aiConfig.seguimientosVendedores })
    .from(aiConfig)
    .where(eq(aiConfig.organizationId, organizationId))
    .limit(1);
  const [row] = forUpdate ? await query.for("update") : await query;
  return row ? tableFromStored(row.casos, row.vendedores) : FACTORY_TABLE;
}

/** La tabla vigente (caché de 60 s por organización). */
export async function loadFollowUpTable(organizationId: string, now: Date = new Date()): Promise<FollowUpTable> {
  const hit = cache.get(organizationId);
  if (hit && now.getTime() - hit.at < FOLLOW_UP_TABLE_CACHE_MS && now.getTime() >= hit.at) return hit.table;
  const table = await readTable(db, organizationId);
  cache.set(organizationId, { at: now.getTime(), table });
  return table;
}

/** Sin argumento borra todo (pruebas); con organización, solo la suya (al guardar). */
export function clearFollowUpTableCache(organizationId?: string): void {
  if (organizationId === undefined) cache.clear();
  else cache.delete(organizationId);
}

/** Lo que muestra la pantalla: siempre lo guardado, sin caché. */
export async function loadFollowUpTableFresh(organizationId: string): Promise<FollowUpTable> {
  return readTable(db, organizationId);
}

export type TableLastChange = { author: string | null; at: Date };

/** «Último cambio: Daniel, hoy 11:20». */
export async function loadLastTableChange(organizationId: string): Promise<TableLastChange | null> {
  const [row] = await db
    .select({ at: changeHistory.createdAt, authorName: changeHistory.authorName, current: user.name })
    .from(changeHistory)
    .leftJoin(user, eq(user.id, changeHistory.userId))
    .where(and(eq(changeHistory.organizationId, organizationId), eq(changeHistory.kind, "seguimientos")))
    .orderBy(desc(changeHistory.createdAt))
    .limit(1);
  return row ? { author: row.authorName ?? row.current ?? null, at: row.at } : null;
}

/**
 * Guarda la tabla completa. Si nada cambió no escribe nada. Cada guardado con cambios deja UNA fila en el
 * Historial (con la lista de cambios para «Ver cambios»), en la misma transacción.
 */
export async function saveFollowUpTable(organizationId: string, userId: string | null, next: FollowUpTable): Promise<{ table: FollowUpTable; changes: TableChange[] }> {
  const result = await db.transaction(async (tx) => {
    // La fila de ai_config existe siempre que se edita (se crea con los valores de siempre).
    await tx
      .insert(aiConfig)
      .values({ organizationId, modeloFiltro: DEFAULT_FILTER_MODEL, modeloCerebro: DEFAULT_BRAIN_MODEL })
      .onConflictDoNothing({ target: aiConfig.organizationId });
    const before = await readTable(tx, organizationId, true);
    const changes = tableChanges(before, next);
    if (changes.length === 0) return { table: before, changes };
    const stored = tableToStored(next);
    await tx
      .update(aiConfig)
      .set({ seguimientosCasos: stored.casos, seguimientosVendedores: stored.vendedores, updatedAt: new Date() })
      .where(eq(aiConfig.organizationId, organizationId));
    await logChanges(tx, {
      organizationId,
      userId,
      kind: "seguimientos",
      action: "editar",
      // Sin «antes → después» en el renglón: la lista completa va en «Ver cambios».
      oldValue: null,
      newValue: null,
      detail: { type: "lineas", lines: changes },
    });
    return { table: next, changes };
  });
  clearFollowUpTableCache(organizationId);
  return result;
}
