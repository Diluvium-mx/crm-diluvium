// "Apagar bot" por conversación (25-sep-2026): opciones del menú, cálculo de la
// hora de regreso y su texto ("vuelve hoy 22:30"). PURO y seguro para el cliente:
// el menú valida con esto antes de enviar y la Server Action lo vuelve a validar.
// Todas las horas son de Mazatlán (America/Mazatlan), como los programados.
import { instantToLocal, localToInstant } from "@/lib/scheduled/rules";

export const PAUSE_OPTIONS = ["8h", "12h", "24h", "exacta", "indefinido"] as const;
export type PauseOption = (typeof PAUSE_OPTIONS)[number];

export const PAUSE_OPTION_LABELS: Record<PauseOption, string> = {
  "8h": "8 horas",
  "12h": "12 horas",
  "24h": "24 horas",
  exacta: "Hasta una fecha y hora…",
  indefinido: "Hasta que lo reactive",
};

const HOUR_MS = 3_600_000;
const FIXED_HOURS: Partial<Record<PauseOption, number>> = { "8h": 8, "12h": 12, "24h": 24 };

/** Tope de "hasta una fecha y hora": 30 días. */
export const MAX_PAUSE_MS = 30 * 24 * HOUR_MS;

export const PAUSE_ERRORS = {
  invalid: "Elige una fecha y hora válidas (hora de Mazatlán).",
  past: "Esa hora ya pasó. Elige una hora futura (hora de Mazatlán).",
  tooFar: "Solo se puede apagar hasta 30 días.",
} as const;

export type PauseUntilResult = { ok: true; until: Date | null } | { ok: false; message: string };

/**
 * Hora de regreso del bot para la opción elegida. `until: null` = "hasta que lo
 * reactive" (sin tiempo). `atLocal` es el valor de un <input type="datetime-local">
 * ("2026-09-25T22:30") en hora de Mazatlán; solo cuenta con la opción "exacta".
 */
export function pauseUntil(option: PauseOption, now: Date, atLocal?: string | null): PauseUntilResult {
  const hours = FIXED_HOURS[option];
  if (hours) return { ok: true, until: new Date(now.getTime() + hours * HOUR_MS) };
  if (option === "indefinido") return { ok: true, until: null };
  const at = localToInstant(atLocal ?? "");
  if (!at) return { ok: false, message: PAUSE_ERRORS.invalid };
  if (at.getTime() <= now.getTime()) return { ok: false, message: PAUSE_ERRORS.past };
  if (at.getTime() - now.getTime() > MAX_PAUSE_MS) return { ok: false, message: PAUSE_ERRORS.tooFar };
  return { ok: true, until: at };
}

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Día de calendario siguiente a "2026-09-25" (aritmética de calendario, sin zona).
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Cuándo vuelve el bot, en hora de Mazatlán y relativo a `now`:
 * "hoy 22:30", "mañana 08:15" o "sáb 26-sep 10:00".
 */
export function returnLabel(until: Date, now: Date): string {
  const local = instantToLocal(until); // "2026-09-26T10:00"
  const [date, time] = [local.slice(0, 10), local.slice(11, 16)];
  const today = instantToLocal(now).slice(0, 10);
  if (date === today) return `hoy ${time}`;
  if (date === nextDay(today)) return `mañana ${time}`;
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d}-${MONTHS[m - 1]} ${time}`;
}
