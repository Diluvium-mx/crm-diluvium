// Filtro por temperatura y «Destacado» de la Bandeja y el Embudo. PURO: lo usan la
// consulta de la Bandeja (servidor) y el tablero del Embudo (navegador).
//
// Regla del dueño (28/29-sep-2026): temperatura y Destacado son cosas DISTINTAS y se
// combinan.
//   - Temperatura: una a la vez (🔥 caliente · 🧊 frío · ⏳ en espera · ○ sin asignar), o
//     ninguna (todas).
//   - Destacado: la marca ⭐ del contacto (contacts.destacado, 0048): la estrella de la
//     Bandeja y el ⭐ del Embudo son el mismo dato.
//   - Las dos condiciones se suman (Y): «🔥 + Destacado» = calientes y destacados.

export const TEMPERATURE_FILTERS = ["caliente", "frio", "en_espera", "none"] as const;

/** `none` = sin temperatura asignada (○). */
export type TemperatureFilter = (typeof TEMPERATURE_FILTERS)[number];

export function isTemperatureFilter(value: unknown): value is TemperatureFilter {
  return typeof value === "string" && (TEMPERATURE_FILTERS as readonly string[]).includes(value);
}

/** ¿La temperatura del contacto pasa el filtro? Sin filtro (null) pasa todo. */
export function matchesTemperature(temperature: string | null | undefined, filter: TemperatureFilter | null): boolean {
  if (filter === null) return true;
  if (filter === "none") return temperature == null;
  return temperature === filter;
}

export type CardFilter = { temperature: TemperatureFilter | null; destacado: boolean };

export function hasCardFilter(filter: CardFilter): boolean {
  return filter.temperature !== null || filter.destacado;
}

/** Tarjeta del Embudo: pasa si cumple la temperatura Y (si se pidió) es Destacado. */
export function matchesCardFilter(contact: { temperature: string | null; destacado: boolean }, filter: CardFilter): boolean {
  if (!matchesTemperature(contact.temperature, filter.temperature)) return false;
  return !filter.destacado || contact.destacado;
}
