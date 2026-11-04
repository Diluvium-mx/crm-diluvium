// Renovación de la caché del Agente IA (2-oct-2026, decisión del dueño; las 24 horas desde el
// 9-oct-2026). PURO: decide si toca renovar. El que llama a Anthropic es cache-keepalive.ts.
//
// La caché de Anthropic dura 1 hora desde la ÚLTIMA vez que se escribió o se leyó (leer
// reinicia el reloj sin costo). Si la última llamada que la tocó empezó hace 50 min o más y la
// caché sigue viva, el worker manda una petición mínima (mismo system y herramientas, 1 token de
// salida) que solo la LEE: ~US$0.005 contra ~US$0.09 de volver a escribirla (~22 mil tokens).
// Antes solo de 7:00 a 22:00: la primera respuesta de la noche y la primera después de las 7:00
// volvían a escribirla (11 veces del 3 al 8-oct, ≈ US$5.7 al mes); renovar de noche cuesta
// ≈ US$1.6 al mes. Nunca escribe una caché vencida. El Agente IA contesta igual: solo cambia el costo.

/** Vida de la caché (ttl "1h" en anthropic-cache.ts). */
export const CACHE_TTL_MS = 60 * 60_000;
/** Se renueva a partir de los 50 min… */
export const REFRESH_AFTER_MS = 50 * 60_000;
/** …y no después de los 58 (margen para la duración de la petición y el barrido de cada minuto). */
export const REFRESH_DEADLINE_MS = 58 * 60_000;

/**
 * ¿Toca renovar? `lastTouchStart` = inicio de la última llamada que leyó o escribió la caché de
 * ese modelo (null = no hay ninguna reciente). Solo una caché viva.
 */
export function keepAliveDue(now: Date, lastTouchStart: Date | null): boolean {
  if (!lastTouchStart) return false;
  const elapsed = now.getTime() - lastTouchStart.getTime();
  return elapsed >= REFRESH_AFTER_MS && elapsed < REFRESH_DEADLINE_MS;
}

/**
 * Última vez que se tocó la caché, para la regla de arriba (9-oct-2026).
 * - `good`: inicio de la última respuesta que leyó o escribió la caché, o de la última renovación
 *   que la LEYÓ.
 * - `coldSinceGood` / `lastCold`: renovaciones que no la encontraron y la volvieron a ESCRIBIR
 *   (cambió el Goal, una FAQ o las herramientas) después de `good`.
 * La PRIMERA renovación que la reescribe sí cuenta: la caché nueva quedó viva y se sigue
 * renovando (antes se dejaba de renovar y la siguiente respuesta la pagaba otra vez: 8-oct 13:11
 * y 17:39). Si la siguiente renovación TAMBIÉN la reescribe, la renovación no coincide con las
 * respuestas: se deja de renovar hasta la siguiente respuesta real (a lo más dos escrituras).
 */
/** Una llamada reciente del cerebro a ese modelo (respuesta o renovación), para goodTouch. */
export type TouchRow = { start: Date; renewal: boolean; read: number; write: number };

/**
 * `good` de effectiveTouch, calculado de las llamadas de las últimas 2 h (4-nov-2026, el reloj de los
 * toques): cuenta toda llamada que LEYÓ la caché y la respuesta que la ESCRIBIÓ sin leerla solo si no había
 * una caché viva (ninguna lectura en la hora anterior: cambió el Goal o se venció). Si había una viva y la
 * respuesta no la encontró, esa respuesta usó OTRA caché (otras herramientas o system): antes movía el
 * reloj, la renovación se saltaba y la caché compartida se vencía (1-nov 17:23 → 18:15: 0.13 + 0.11).
 */
export function goodTouch(rows: readonly TouchRow[]): Date | null {
  const sorted = [...rows].sort((a, b) => a.start.getTime() - b.start.getTime());
  let lastRead: Date | null = null;
  let good: Date | null = null;
  for (const r of sorted) {
    if (r.read > 0) {
      lastRead = r.start;
      good = r.start;
    } else if (!r.renewal && r.write > 0 && (!lastRead || r.start.getTime() - lastRead.getTime() >= CACHE_TTL_MS)) {
      good = r.start;
    }
  }
  return good;
}

export function effectiveTouch(good: Date | null, coldSinceGood: number, lastCold: Date | null): Date | null {
  if (coldSinceGood === 1 && lastCold && (!good || lastCold > good)) return lastCold;
  return good;
}
