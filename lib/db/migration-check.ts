// Candado de migraciones: ¿la base tiene aplicadas TODAS las migraciones del
// journal? drizzle-orm aplica una migración solo si su `when` es MAYOR que el
// created_at de la última aplicada (pg-core/dialect.js); una con `when` menor
// (p. ej. la de una rama que entró a main después de otra más nueva) se SALTA
// EN SILENCIO y `drizzle-kit migrate` termina "bien". Este chequeo lo detecta:
// cada entrada del journal debe tener su fila en drizzle.__drizzle_migrations
// (drizzle guarda created_at = `when` del journal y hash = sha256 del .sql).
//
// Se usa en el despliegue (pre-deploy del web y del worker en Railway, ver
// docs/migraciones.md): si falta alguna, el despliegue NO avanza y la versión
// anterior sigue atendiendo. También en el arranque del worker.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

export type JournalEntry = { idx: number; tag: string; when: number };
export type AppliedMigration = { createdAt: number; hash: string };

export type MigrationReport = {
  /** Del journal y NO aplicadas en la base (bloquean el despliegue). */
  missing: JournalEntry[];
  /** Aplicadas con un .sql distinto al actual (alguien editó una migración ya aplicada). */
  changed: JournalEntry[];
  /** Filas de la base que no están en el journal (p. ej. una migración retirada): solo aviso. */
  unknown: AppliedMigration[];
  ok: boolean;
};

/** Compara (puro). `hashes` = sha256 del .sql por tag; sin él no se revisan cambios. */
export function compareMigrations(
  journal: JournalEntry[],
  applied: AppliedMigration[],
  hashes?: ReadonlyMap<string, string>,
): MigrationReport {
  const byWhen = new Map(applied.map((a) => [a.createdAt, a]));
  const missing: JournalEntry[] = [];
  const changed: JournalEntry[] = [];
  for (const entry of journal) {
    const row = byWhen.get(entry.when);
    if (!row) missing.push(entry);
    else if (hashes?.has(entry.tag) && row.hash && row.hash !== hashes.get(entry.tag)) changed.push(entry);
  }
  const known = new Set(journal.map((e) => e.when));
  const unknown = applied.filter((a) => !known.has(a.createdAt));
  return { missing, changed, unknown, ok: missing.length === 0 };
}

export function readJournal(root = process.cwd()): JournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")) as { entries: JournalEntry[] };
  return journal.entries;
}

/** sha256 de cada .sql, igual que drizzle-orm (readMigrationFiles: hash del archivo completo). */
export function migrationHashes(journal: JournalEntry[], root = process.cwd()): Map<string, string> {
  const out = new Map<string, string>();
  for (const { tag } of journal) {
    const file = path.join(root, "drizzle", `${tag}.sql`);
    out.set(tag, createHash("sha256").update(readFileSync(file, "utf8")).digest("hex"));
  }
  return out;
}

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

// 42P01 = tabla inexistente, 3F000 = esquema inexistente (base nueva, sin migrar).
const NOT_MIGRATED_YET = new Set(["42P01", "3F000"]);

/** Migraciones aplicadas según la base ([] si la base aún no tiene ninguna). */
export async function readApplied(database: Executor): Promise<AppliedMigration[]> {
  try {
    const rows = (await database.execute(
      sql`select created_at::text as created_at, hash from drizzle.__drizzle_migrations`,
    )) as { created_at: string; hash: string }[];
    return rows.map((r) => ({ createdAt: Number(r.created_at), hash: r.hash }));
  } catch (error) {
    if (NOT_MIGRATED_YET.has((error as { code?: string }).code ?? "")) return [];
    throw error;
  }
}

/** Texto para el log del despliegue. */
export function describeReport(report: MigrationReport): string {
  const lines: string[] = [];
  if (report.missing.length) {
    lines.push(`FALTAN ${report.missing.length} migración(es) en la base: ${report.missing.map((m) => `${m.tag} (when ${m.when})`).join(", ")}`);
    lines.push("drizzle las saltó (su `when` es menor que la última aplicada) o su despliegue falló. Nada se sirve hasta corregirlo.");
  }
  if (report.changed.length) {
    lines.push(`AVISO: ${report.changed.length} migración(es) aplicada(s) con un .sql distinto al del repo: ${report.changed.map((m) => m.tag).join(", ")}`);
  }
  if (report.unknown.length) {
    lines.push(`Aviso: ${report.unknown.length} fila(s) aplicada(s) que no están en el journal (when ${report.unknown.map((u) => u.createdAt).join(", ")}).`);
  }
  if (report.ok) lines.unshift("Migraciones al día: todas las del journal están aplicadas.");
  return lines.join("\n");
}
