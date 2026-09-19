// Uso: npx tsx scripts/reset-db.ts
// SOLO DEV: borra y recrea el schema para re-aplicar migraciones desde cero
// (p. ej. cuando una migración cambió de hash, como la 0008). Rechaza URLs
// que parezcan remotas/producción para no borrar datos reales por accidente.
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (/railway|rlwy\.net|amazonaws|neon\.tech|supabase|\.rds\./i.test(url) && process.env.ALLOW_REMOTE_RESET !== "1") {
    throw new Error(
      "DATABASE_URL parece remota/producción; reset-db es SOLO para tu BD local de dev. " +
        "Si de verdad quieres forzarlo, ALLOW_REMOTE_RESET=1 (bajo tu riesgo).",
    );
  }
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
    console.error(err);
    process.exit(1);
  });
