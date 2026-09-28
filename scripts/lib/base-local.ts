// Guarda de los scripts que meten datos FALSOS o borran (reset-db y los seed-*): solo
// corren contra una base LOCAL de desarrollo. Falla CERRADO: host loopback, nombre de
// base con dev/test/local y fuera de NODE_ENV=production, para no ensuciar ni borrar
// datos reales por un DATABASE_URL mal puesto (ya pasó: seeds en producción).

// Hosts loopback: la BD tiene que estar en esta misma máquina.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);
// El nombre de la BD debe declararse de dev/test/local explícitamente.
const DEV_DB_NAME = /(^|[_-])(dev|test|local)([_-]|$)|dev$|_dev|test$|_test/i;

/**
 * Lanza un error si `rawUrl` no es una base local de desarrollo. `escape` es el nombre de
 * una variable que, en "1", la salta bajo tu riesgo (solo reset-db la tiene).
 */
export function assertLocalDevDatabase(rawUrl: string | undefined, script: string, escape?: string): asserts rawUrl is string {
  if (!rawUrl) throw new Error("DATABASE_URL is not set");
  if (escape && process.env[escape] === "1") return; // escape explícito, bajo tu riesgo
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${script} no corre con NODE_ENV=production.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`DATABASE_URL no es una URL válida; ${script} se detiene.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `${script} corre SOLO contra una base local: el host "${host}" no es loopback (localhost/127.0.0.1/::1). ` +
        "Cualquier host remoto (Railway, Render, Fly, RDS, una IP, etc.) se rechaza." +
        (escape ? ` Si de verdad lo quieres forzar, ${escape}=1 (bajo tu riesgo).` : ""),
    );
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!DEV_DB_NAME.test(dbName)) {
    throw new Error(
      `La base "${dbName}" no parece de desarrollo. ${script} exige un nombre con dev/test/local ` +
        "(p. ej. crm_diluvium_dev) para no tocar una base equivocada.",
    );
  }
}
