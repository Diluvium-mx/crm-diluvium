// Aviso «Hay una nueva actualización del CRM: recarga la página» (1-oct-2026, decisión
// del dueño). Sale SOLO cuando falló algo que hizo el vendedor y la causa es que la pestaña
// es de una versión anterior del CRM; nunca por haber versión nueva sin falla, ni por un
// refresco automático que falló. Aquí van las reglas puras: qué falla merece revisar la
// versión, si la hizo el vendedor y cuándo dos versiones son distintas.

export const MENSAJE_ACTUALIZACION = "Hay una nueva actualización del CRM: recarga la página";

// Next 16 responde con esta cabecera cuando una pestaña vieja llama a una Server Action
// que ya no existe en la versión nueva (en el navegador lanza UnrecognizedActionError).
export const ACTION_NOT_FOUND_HEADER = "x-nextjs-action-not-found";

export const VERSION_PATH = "/api/version";

/** "segura" = la falla ya dice que la versión cambió; "revisar" = hay que preguntar la versión. */
export type Senal = "segura" | "revisar" | null;

/** ¿La URL es de este mismo CRM (y no la consulta de versión, para no dar vueltas)? */
export function esDelCrm(url: string, origen: string): boolean {
  try {
    const u = new URL(url, origen);
    return u.origin === origen && u.pathname !== VERSION_PATH;
  } catch {
    return false;
  }
}

/** ¿Es un archivo del propio CRM (scripts y estilos que arma Next al construir)? */
export function esArchivoDelCrm(url: string, origen: string): boolean {
  return esDelCrm(url, origen) && new URL(url, origen).pathname.startsWith("/_next/");
}

/**
 * Qué dice una respuesta a una petición del navegador. Solo cuentan las del CRM: una
 * acción que ya no existe es segura; un 404 o un error del servidor (5xx) se revisan. Las
 * demás (400, 401, 403, 413…) son respuestas normales de la app, no de versión.
 */
export function senalDeRespuesta(
  respuesta: { url: string; status: number; headers: { get(name: string): string | null } },
  origen: string,
): Senal {
  if (!esDelCrm(respuesta.url, origen)) return null;
  if (respuesta.headers.get(ACTION_NOT_FOUND_HEADER)) return "segura";
  if (respuesta.status === 404 || respuesta.status >= 500) return "revisar";
  return null;
}

/** La acción que se llamó ya no existe en el servidor (versión nueva). */
export function esAccionNoEncontrada(error: unknown): boolean {
  return error instanceof Error && error.name === "UnrecognizedActionError";
}

// Next 16 renueva los identificadores de TODAS las Server Actions en cada build: en una pestaña
// vieja fallan también los refrescos automáticos (mensajes nuevos por SSE, programados cada
// 30 s, la píldora del Agente IA). Esos NO prenden el aviso (decisión del dueño): solo cuenta
// una petición que salió poco después de un gesto del vendedor (clic, tecla, archivo elegido,
// soltar o pegar).
export const VENTANA_GESTO_MS = 3_000;

/** ¿La petición salió por algo que hizo el vendedor (hasta VENTANA_GESTO_MS después de su último gesto)? */
export function esDelVendedor(salioMs: number, ultimoGestoMs: number | null, ventanaMs: number = VENTANA_GESTO_MS): boolean {
  return ultimoGestoMs !== null && salioMs >= ultimoGestoMs && salioMs - ultimoGestoMs <= ventanaMs;
}

/** Una petición que el propio navegador canceló no es una falla. */
export function esCancelacion(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Versión de la pestaña contra la del servidor: solo cuenta si ambas se conocen. */
export function esVersionDistinta(local: string, servidor: unknown): boolean {
  return local.length > 0 && typeof servidor === "string" && servidor.length > 0 && servidor !== local;
}
