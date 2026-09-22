// El worker NO corre migraciones (las corre el web al arrancar: `drizzle-kit
// migrate` en start:web). Si ambos despliegan el mismo commit a la vez, el
// worker podría consultar columnas que todavía no existen. Por eso espera a que
// la base tenga aplicada la ÚLTIMA migración del journal antes de consumir
// colas o barrer. drizzle aplica por `when` del journal vs el created_at más
// alto de drizzle.__drizzle_migrations (pg-core/dialect.js), así que basta
// comparar esos dos números.
//
// Nunca espera a ciegas: solo "la tabla/esquema aún no existe" cuenta como
// pendiente; cualquier otro error (credenciales, red) se propaga. Hay un plazo
// total: si el web no migró a tiempo (p. ej. su migración falló), el worker
// termina con error para que el deploy falle a la vista en vez de quedar vivo
// e inerte.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const QUERY_TIMEOUT_MS = 10_000;
const DEFAULT_DEADLINE_MS = Number(process.env.WORKER_MIGRATION_WAIT_MS ?? 10 * 60_000);

function latestJournalWhen(): number {
  const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
    entries: { when: number }[];
  };
  return Math.max(...journal.entries.map((e) => e.when));
}

// 42P01 = tabla inexistente, 3F000 = esquema inexistente (base nueva, sin migrar).
const NOT_MIGRATED_YET = new Set(["42P01", "3F000"]);

async function appliedUpTo(): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      db.execute<{ last: string | null }>(sql`select max(created_at)::text as last from drizzle.__drizzle_migrations`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("la consulta de migraciones tardó demasiado")), QUERY_TIMEOUT_MS);
      }),
    ]);
    return Number(rows[0]?.last ?? 0);
  } catch (error) {
    if (NOT_MIGRATED_YET.has((error as { code?: string }).code ?? "")) return 0;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resuelve cuando la base ya tiene la última migración del código. Reintenta
 * cada `everyMs`, avisa cada minuto y lanza si vence `deadlineMs`.
 */
export async function waitForMigrations({
  everyMs = 5_000,
  deadlineMs = DEFAULT_DEADLINE_MS,
  log = console as Pick<Console, "info">,
}: { everyMs?: number; deadlineMs?: number; log?: Pick<Console, "info"> } = {}): Promise<void> {
  const target = latestJournalWhen();
  const started = Date.now();
  let lastLog = 0;
  for (;;) {
    const applied = await appliedUpTo();
    if (applied >= target) return;
    const elapsed = Date.now() - started;
    if (elapsed >= deadlineMs) {
      throw new Error(
        `la base sigue sin la migración ${target} (última aplicada ${applied}) tras ${Math.round(elapsed / 1000)} s; ` +
          "¿falló el deploy del web?",
      );
    }
    if (lastLog === 0 || Date.now() - lastLog >= 60_000) {
      log.info(`[worker] esperando a que el web aplique las migraciones (${applied} → ${target}) antes de arrancar`);
      lastLog = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
