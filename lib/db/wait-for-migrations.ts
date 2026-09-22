// El worker NO corre migraciones (las corre el web al arrancar: `drizzle-kit
// migrate` en start:web). Si ambos despliegan el mismo commit a la vez, el
// worker podría consultar columnas que todavía no existen. Por eso espera a que
// la base tenga aplicada la ÚLTIMA migración del journal antes de consumir
// colas o barrer. drizzle aplica por `when` del journal vs el created_at más
// alto de drizzle.__drizzle_migrations (pg-core/dialect.js), así que basta
// comparar esos dos números.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

function latestJournalWhen(): number {
  const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
    entries: { when: number }[];
  };
  return Math.max(...journal.entries.map((e) => e.when));
}

async function appliedUpTo(): Promise<number> {
  try {
    const rows = await db.execute<{ last: string | null }>(sql`select max(created_at)::text as last from drizzle.__drizzle_migrations`);
    return Number(rows[0]?.last ?? 0);
  } catch {
    return 0; // la tabla aún no existe (base nueva)
  }
}

/** Resuelve cuando la base ya tiene la última migración del código; reintenta cada 5 s. */
export async function waitForMigrations({
  everyMs = 5_000,
  log = console as Pick<Console, "info">,
}: { everyMs?: number; log?: Pick<Console, "info"> } = {}): Promise<void> {
  const target = latestJournalWhen();
  let warned = false;
  for (;;) {
    if ((await appliedUpTo()) >= target) return;
    if (!warned) {
      log.info(`[worker] esperando a que el web aplique las migraciones (hasta ${target}) antes de arrancar`);
      warned = true;
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
