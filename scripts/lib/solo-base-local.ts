// Se importa PRIMERO (antes que @/lib/db o @/lib/auth) en los scripts que meten datos
// FALSOS (seed-*): si DATABASE_URL no es una base local de desarrollo, detiene el
// proceso antes de cargar nada más. Guarda: ./base-local.ts (la misma de reset-db).
import { basename } from "node:path";
import { assertLocalDevDatabase } from "./base-local";

try {
  assertLocalDevDatabase(process.env.DATABASE_URL, basename(process.argv[1] ?? "script", ".ts"));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
