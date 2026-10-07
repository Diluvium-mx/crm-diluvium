// Calendario propio del CRM (7-oct-2026, aprobado por el dueño): las cuentas del selector de fecha y hora.
// PURO y seguro para el cliente. Los valores van en el MISMO formato que los <input> nativos que reemplaza,
// para que el resto del código no cambie: "AAAA-MM-DD" (fecha), "HH:MM" (hora, 24 h) o "AAAA-MM-DDTHH:MM"
// (fecha y hora). En pantalla, como el nativo de Chrome en español: "08/10/2026, 05:00 p.m.".

export type PickerMode = "datetime" | "date" | "time";
export type PickerParts = { y: number; m: number; d: number; hh: number; mm: number };
export type CalendarDay = { y: number; m: number; d: number; inMonth: boolean; value: string };

const pad = (n: number) => String(n).padStart(2, "0");

export function dateValue(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function timeValue(hh: number, mm: number): string {
  return `${pad(hh)}:${pad(mm)}`;
}

/** Valor del input → partes; null si viene vacío o no es válido para ese modo. */
export function parseValue(value: string | null | undefined, mode: PickerMode): PickerParts | null {
  if (!value) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const time = /(?:^|T)(\d{2}):(\d{2})$/.exec(value);
  if (mode !== "time" && !date) return null;
  if (mode !== "date" && !time) return null;
  const [y, m, d] = date ? [Number(date[1]), Number(date[2]), Number(date[3])] : [2000, 1, 1];
  const [hh, mm] = time ? [Number(time[1]), Number(time[2])] : [0, 0];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m) || hh > 23 || mm > 59) return null;
  return { y, m, d, hh, mm };
}

/** Partes → valor del input. */
export function formatValue(p: PickerParts, mode: PickerMode): string {
  if (mode === "date") return dateValue(p.y, p.m, p.d);
  if (mode === "time") return timeValue(p.hh, p.mm);
  return `${dateValue(p.y, p.m, p.d)}T${timeValue(p.hh, p.mm)}`;
}

/** 0 → 12 a.m.; 13 → 1 p.m. */
export function to12h(hh: number): { h12: number; ap: "a.m." | "p.m." } {
  return { h12: hh % 12 === 0 ? 12 : hh % 12, ap: hh < 12 ? "a.m." : "p.m." };
}

export function from12h(h12: number, ap: "a.m." | "p.m."): number {
  const base = h12 % 12;
  return ap === "p.m." ? base + 12 : base;
}

/** Lo que se lee en el campo: "08/10/2026, 05:00 p.m.", "08/10/2026" o "05:00 p.m.". */
export function displayValue(value: string | null | undefined, mode: PickerMode): string {
  const p = parseValue(value, mode);
  if (!p) return "";
  const { h12, ap } = to12h(p.hh);
  const date = `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  const time = `${pad(h12)}:${pad(p.mm)} ${ap}`;
  return mode === "date" ? date : mode === "time" ? time : `${date}, ${time}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Mes anterior o siguiente. */
export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const i = y * 12 + (m - 1) + delta;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

/** Las 6 semanas del mes (lunes primero), con los días del mes anterior y siguiente para rellenar. */
export function monthMatrix(y: number, m: number): CalendarDay[] {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = domingo
  const lead = (first + 6) % 7; // días del mes anterior antes del lunes
  const out: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const t = new Date(Date.UTC(y, m - 1, 1 + i - lead));
    const [yy, mm, dd] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
    out.push({ y: yy, m: mm, d: dd, inMonth: mm === m, value: dateValue(yy, mm, dd) });
  }
  return out;
}

/** ¿El día queda fuera de [min, max]? (min/max en el formato del input; se compara solo la fecha). */
export function dayOutOfRange(day: string, min?: string, max?: string): boolean {
  return (min !== undefined && min !== "" && day < min.slice(0, 10)) || (max !== undefined && max !== "" && day > max.slice(0, 10));
}

/** Lleva un valor completo dentro de [min, max] (los dos en el mismo formato: se comparan como texto). */
export function clampValue(value: string, min?: string, max?: string): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

/** Minutos de la columna: 00…59 de `step` en `step` (incluye el actual aunque no caiga en el paso). */
export function minuteOptions(step: number, current?: number): number[] {
  const s = Math.max(1, Math.min(30, Math.floor(step)));
  const list = Array.from({ length: Math.ceil(60 / s) }, (_, i) => i * s);
  if (current !== undefined && !list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

export const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;
export const WEEKDAY_INITIALS = ["L", "M", "M", "J", "V", "S", "D"] as const;
