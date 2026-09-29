// Filtro por temperatura y «Destacado» de la Bandeja y el Embudo (28-sep-2026). PURO:
// lo usan la consulta de la Bandeja (servidor) y el tablero del Embudo (navegador).
//
// Regla del dueño: temperatura y Destacado son cosas DISTINTAS que se pueden combinar.
//   - Temperatura: una a la vez (🔥 caliente · 🧊 frío · ⏳ en espera · ○ sin asignar), o
//     ninguna (todas).
//   - Destacado: la estrella del chat (conversations.is_starred) O la temperatura ⭐
//     (contacts.temperature = 'destacado'). La ⭐ se quedó como valor de temperatura,
//     pero elegirla es elegir «Destacado», no una temperatura más; por eso no aparece
//     entre las temperaturas del filtro y sí cuenta en Destacado.
//   - Las dos condiciones se suman (Y): «🔥 + Destacado» = calientes con estrella.

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

/** Destacado = estrella del chat o temperatura ⭐. */
export function isDestacado(temperature: string | null | undefined, starred: boolean | undefined): boolean {
  return starred === true || temperature === "destacado";
}

export type CardFilter = { temperature: TemperatureFilter | null; destacado: boolean };

export function hasCardFilter(filter: CardFilter): boolean {
  return filter.temperature !== null || filter.destacado;
}

/** Tarjeta del Embudo: pasa si cumple la temperatura Y (si se pidió) es Destacado. */
export function matchesCardFilter(
  contact: { temperature: string | null },
  starred: boolean | undefined,
  filter: CardFilter,
): boolean {
  if (!matchesTemperature(contact.temperature, filter.temperature)) return false;
  return !filter.destacado || isDestacado(contact.temperature, starred);
}
