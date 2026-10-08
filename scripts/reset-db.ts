// Uso: npx tsx scripts/reset-db.ts
// SOLO DEV: borra y recrea el schema para re-aplicar migraciones desde cero
// (p. ej. cuando una migración cambió de hash, como la 0008). Falla CERRADO:
// solo procede contra una BD LOCAL (loopback) con nombre de desarrollo y fuera
// de producción (guarda en scripts/lib/base-local.ts, la misma de los seed-*).
import postgres from "postgres";
import { assertLocalDevDatabase } from "./lib/base-local";
import { logError } from "@/lib/log/safe-error";

async function main() {
  const url = process.env.DATABASE_URL;
  assertLocalDevDatabase(url, "reset-db", "ALLOW_REMOTE_RESET");
  const sql = postgres(url, { max: 1 });
  // Se borra también el schema `drizzle` (journal de migraciones) para que
  // db:migrate vuelva a aplicarlas todas desde cero.
  await sql.unsafe("drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;");
  await sql.end();
  console.log("Schema local recreado. Sigue: db:migrate.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logError("[db:reset]", err);
    process.exit(1);
  });
