// Errores para los logs SIN datos de clientes (S3, revisión de seguridad CN-011,
// 30-sep-2026). Drizzle envuelve cada falla de la base en DrizzleQueryError con
// el mensaje "Failed query: … params: …": esos parámetros son teléfonos, nombres
// y textos de mensajes, y `console.error(…, error)` los imprimía (también su
// `stack`, que repite el mensaje, y el `detail` de Postgres con los valores).
// Aquí solo sale el código y el mensaje de Postgres y el SQL sin parámetros.
import { DrizzleQueryError } from "drizzle-orm/errors";

const QUERY_PREVIEW = 160;

type PgCause = { code?: unknown; message?: unknown };

/** Texto del error apto para logs, la base (last_error) y el issue público del monitor. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const cause = (error.cause ?? {}) as PgCause;
    const code = typeof cause.code === "string" ? cause.code : "sin código";
    const reason = typeof cause.message === "string" ? cause.message : "falló la consulta";
    const query = error.query.replace(/\s+/g, " ").trim().slice(0, QUERY_PREVIEW);
    return `consulta a la base falló (${code}): ${reason} · ${query}`;
  }
  if (error instanceof Error) {
    // Por si un error ajeno trae adentro un mensaje de Drizzle: se corta en "params:".
    return error.message.split(/\nparams:/)[0];
  }
  return String(error);
}

/**
 * console.error con el texto seguro; la pila solo si no es de una consulta (repite los
 * parámetros) y solo sus líneas «at …»: el encabezado de la pila repite el mensaje
 * completo, también las líneas que safeErrorMessage cortó.
 */
export function logError(tag: string, error: unknown): void {
  if (error instanceof Error && !(error instanceof DrizzleQueryError) && error.stack) {
    const frames = error.stack.split("\n").filter((line) => /^\s+at /.test(line));
    if (frames.length) {
      console.error(tag, safeErrorMessage(error), "\n", frames.join("\n"));
      return;
    }
  }
  console.error(tag, safeErrorMessage(error));
}
