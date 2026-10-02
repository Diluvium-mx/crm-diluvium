// Hora local de cualquier zona (IANA) ↔ instante UTC, para los seguimientos (la hora del
// cliente según su lada). PURO. Igual que lib/scheduled/rules.ts (Mazatlán), pero con la zona
// como parámetro; se calcula con Intl para no depender de reglas de horario de verano.

export type LocalDate = { y: number; m: number; d: number };
export type LocalParts = LocalDate & { hh: number; mm: number; /** 1 = lunes … 7 = domingo */ weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

function offsetMs(zone: string, instant: Date): number {
  const parts = formatter(zone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function localParts(instant: Date, zone: string): LocalParts {
  const shifted = new Date(instant.getTime() + offsetMs(zone, instant));
  const dow = shifted.getUTCDay();
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
    weekday: dow === 0 ? 7 : dow,
  };
}

/** Fecha y hora local de `zone` → instante. */
export function zonedInstant(zone: string, date: LocalDate, hhmm: string): Date {
  const [h, mi] = hhmm.split(":").map(Number);
  const naive = Date.UTC(date.y, date.m - 1, date.d, h, mi);
  const first = new Date(naive - offsetMs(zone, new Date(naive)));
  return new Date(naive - offsetMs(zone, first));
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function sameDate(a: LocalDate, b: LocalDate): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutos desde la medianoche local. */
export function localMinutes(instant: Date, zone: string): number {
  const p = localParts(instant, zone);
  return p.hh * 60 + p.mm;
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "2026-10-05" → fecha; null si no es una fecha real. */
export function parseLocalDate(text: string): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function formatLocalDate(date: LocalDate): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

export function isHhmm(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}
