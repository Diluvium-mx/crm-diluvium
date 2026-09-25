// El worker NO corre migraciones (las corre el web al arrancar: `drizzle-kit
// migrate` en start:web). Si ambos despliegan el mismo commit a la vez, el
// worker podría consultar columnas que todavía no existen. Por eso espera a que
// la base tenga aplicadas TODAS las migraciones del journal antes de consumir
// colas o barrer (lib/db/migration-check.ts). Antes comparaba solo la última:
// una migración que drizzle SALTÓ (su `when` menor que la última aplicada) no
// se notaba y el worker arrancaba con tablas faltantes.
//
// Nunca espera a ciegas: solo "la tabla/esquema aún no existe" cuenta como
// pendiente; cualquier otro error (credenciales, red) se propaga. Hay un plazo
// total: si el web no migró a tiempo (p. ej. su migración falló), el worker
// termina con error para que el deploy falle a la vista en vez de quedar vivo
// e inerte.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { compareMigrations, readJournal, type JournalEntry } from "./migration-check";

const QUERY_TIMEOUT_MS = 10_000;
const DEFAULT_DEADLINE_MS = Number(process.env.WORKER_MIGRATION_WAIT_MS ?? 10 * 60_000);


// 42P01 = tabla inexistente, 3F000 = esquema inexistente (base nueva, sin migrar).
const NOT_MIGRATED_YET = new Set(["42P01", "3F000"]);

/** created_at de las migraciones aplicadas (vacío si la base aún no tiene ninguna). */
async function appliedWhens(): Promise<Set<number>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      db.execute<{ created_at: string }>(sql`select created_at::text as created_at from drizzle.__drizzle_migrations`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("la consulta de migraciones tardó demasiado")), QUERY_TIMEOUT_MS);
      }),
    ]);
    return new Set(rows.map((r) => Number(r.created_at)));
  } catch (error) {
    if (NOT_MIGRATED_YET.has((error as { code?: string }).code ?? "")) return new Set();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resuelve cuando la base ya tiene TODAS las migraciones del código. Reintenta
 * cada `everyMs`, avisa cada minuto y lanza si vence `deadlineMs`.
 */
export async function waitForMigrations({
  everyMs = 5_000,
  deadlineMs = DEFAULT_DEADLINE_MS,
  log = console as Pick<Console, "info">,
  journal = readJournal(),
}: { everyMs?: number; deadlineMs?: number; log?: Pick<Console, "info">; journal?: JournalEntry[] } = {}): Promise<void> {
  const started = Date.now();
  let lastLog = 0;
  for (;;) {
    const applied = await appliedWhens();
    const { missing } = compareMigrations(journal, [...applied].map((createdAt) => ({ createdAt, hash: "" })));
    if (missing.length === 0) return;
    const pending = missing.map((m) => m.tag).join(", ");
    const elapsed = Date.now() - started;
    if (elapsed >= deadlineMs) {
      throw new Error(
        `la base sigue sin la migración ${pending} tras ${Math.round(elapsed / 1000)} s; ` +
          "¿falló el deploy del web, o drizzle la saltó por un `when` fuera de orden? (npm run db:check)",
      );
    }
    if (lastLog === 0 || Date.now() - lastLog >= 60_000) {
      log.info(`[worker] esperando a que el web aplique las migraciones (faltan: ${pending}) antes de arrancar`);
      lastLog = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
