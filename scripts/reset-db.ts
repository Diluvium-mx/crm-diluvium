// Uso: npx tsx scripts/reset-db.ts
// SOLO DEV: borra y recrea el schema para re-aplicar migraciones desde cero
// (p. ej. cuando una migración cambió de hash, como la 0008). Falla CERRADO:
// solo procede contra una BD LOCAL (loopback) con nombre de desarrollo y fuera
// de producción, para no borrar datos reales por un DATABASE_URL mal puesto.
import postgres from "postgres";

// Hosts loopback: la BD tiene que estar en esta misma máquina.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);
// El nombre de la BD debe declararse de dev/test/local explícitamente.
const DEV_DB_NAME = /(^|[_-])(dev|test|local)([_-]|$)|dev$|_dev|test$|_test/i;

function assertLocalDevUrl(rawUrl: string): void {
  if (process.env.ALLOW_REMOTE_RESET === "1") return; // escape explícito, bajo tu riesgo
  if (process.env.NODE_ENV === "production") {
    throw new Error("reset-db no corre con NODE_ENV=production.");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida; reset-db se detiene.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `reset-db es SOLO para tu BD local: el host "${host}" no es loopback (localhost/127.0.0.1/::1). ` +
        "Cualquier host remoto (Railway, Render, Fly, RDS, una IP, etc.) se rechaza. " +
        "Si de verdad lo quieres forzar, ALLOW_REMOTE_RESET=1 (bajo tu riesgo).",
    );
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!DEV_DB_NAME.test(dbName)) {
    throw new Error(
      `La base "${dbName}" no parece de desarrollo. reset-db exige un nombre con dev/test/local ` +
        "(p. ej. crm_diluvium_dev) para no borrar una base equivocada.",
    );
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  assertLocalDevUrl(url);
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
