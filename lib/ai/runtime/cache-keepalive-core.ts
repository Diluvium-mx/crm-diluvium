// Renovación de la caché del Agente IA en horario laboral (2-oct-2026, decisión del dueño).
// PURO: decide si toca renovar. El que llama a Anthropic es cache-keepalive.ts.
//
// La caché de Anthropic dura 1 hora desde la ÚLTIMA vez que se escribió o se leyó (leer
// reinicia el reloj sin costo). Entre 7:00 y 22:00 (Mazatlán), si la última llamada que la
// tocó empezó hace 50 min o más y la caché sigue viva, el worker manda una petición mínima
// (mismo system y herramientas, 1 token de salida) que solo la LEE: ~US$0.004 contra
// ~US$0.076 de volver a escribirla (~19 mil tokens). Nunca escribe una caché vencida ni
// renueva fuera de horario: ahí la primera respuesta del día la vuelve a escribir, como
// siempre. El Agente IA contesta igual a cualquier hora; esto solo cambia el costo.
import { instantToLocal } from "@/lib/scheduled/rules";

/** Horario en que se mantiene viva (hora de Mazatlán): [desde, hasta), en minutos del día. */
export const KEEPALIVE_FROM_MINUTES = 7 * 60;
export const KEEPALIVE_TO_MINUTES = 22 * 60;
/** Vida de la caché (ttl "1h" en anthropic-cache.ts). */
export const CACHE_TTL_MS = 60 * 60_000;
/** Se renueva a partir de los 50 min… */
export const REFRESH_AFTER_MS = 50 * 60_000;
/** …y no después de los 58 (margen para la duración de la petición y el barrido de cada minuto). */
export const REFRESH_DEADLINE_MS = 58 * 60_000;

/** ¿Este instante cae dentro del horario de renovación (hora de Mazatlán)? */
export function withinKeepAliveHours(now: Date): boolean {
  const hhmm = instantToLocal(now).slice(11, 16);
  const minutes = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return minutes >= KEEPALIVE_FROM_MINUTES && minutes < KEEPALIVE_TO_MINUTES;
}

/**
 * ¿Toca renovar? `lastTouchStart` = inicio de la última llamada que leyó o escribió la caché de
 * ese modelo (null = no hay ninguna reciente). Solo una caché viva y en horario.
 */
export function keepAliveDue(now: Date, lastTouchStart: Date | null): boolean {
  if (!lastTouchStart || !withinKeepAliveHours(now)) return false;
  const elapsed = now.getTime() - lastTouchStart.getTime();
  return elapsed >= REFRESH_AFTER_MS && elapsed < REFRESH_DEADLINE_MS;
}
