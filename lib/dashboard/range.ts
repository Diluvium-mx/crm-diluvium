// Rango de fechas del Dashboard (días LOCALES de America/Mazatlan, inclusivos).
// Llega de la URL (?mes=2026-09 o ?desde=2026-09-01&hasta=2026-09-22), así que
// se valida aquí y cualquier cosa rara cae al mes en curso. Puro: sin BD.

export const DASHBOARD_TIME_ZONE = "America/Mazatlan";
// Tope de días por consulta: suficiente para ver un año sin volver pesada la serie.
export const MAX_RANGE_DAYS = 366;

export type DateRange = { desde: string; hasta: string };
export type RangeInput = { mes?: string; desde?: string; hasta?: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** Fecha local (YYYY-MM-DD) de `now` en la zona del Dashboard. */
export function localToday(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function daysBetween(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function monthRange(month: string): DateRange {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${month}-01`, hasta: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Resuelve el rango pedido. Prioridad: desde/hasta válidos → mes válido → mes
 * en curso. Un rango invertido, de más de MAX_RANGE_DAYS o mal formado se
 * ignora (no se "corrige" a medias).
 */
export function resolveRange(input: RangeInput, now: Date = new Date()): DateRange & { mes: string | null } {
  const { desde, hasta, mes } = input;
  if (desde && hasta && isValidDay(desde) && isValidDay(hasta)) {
    const days = daysBetween(desde, hasta);
    if (days >= 0 && days < MAX_RANGE_DAYS) return { desde, hasta, mes: null };
  }
  if (mes && MONTH_RE.test(mes) && isValidDay(`${mes}-01`)) {
    return { ...monthRange(mes), mes };
  }
  const current = localToday(now).slice(0, 7);
  return { ...monthRange(current), mes: current };
}
