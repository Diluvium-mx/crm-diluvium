// {{1}} de las plantillas de seguimiento con tiempo (TIME_PHRASE_TEMPLATES): CUÁNDO nos escribió el
// cliente, contado en SU calendario (zona según su lada) desde su último mensaje hasta el día en que
// sale la plantilla. Regla fija del CRM (el Agente IA no la decide), siempre en minúsculas, para que
// se lea "…que nos comentó anoche." (decisión del dueño, 3-oct-2026). PURO.
import { localParts } from "./time";

const WEEKDAYS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DAY = 24 * 60 * 60_000;

export function timePhrase(lastClientAt: Date, sendAt: Date, zone: string): string {
  const a = localParts(lastClientAt, zone);
  const b = localParts(sendAt, zone);
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY);
  if (days <= 0) return "hoy";
  if (days === 1) return a.hh >= 19 ? "anoche" : "el día de ayer";
  if (days === 2) return "antier";
  if (days <= 6) return `el ${WEEKDAYS[a.weekday]}`;
  if (days <= 13) return "la semana pasada";
  if (days <= 29) return "hace unas semanas";
  return "hace un tiempo";
}
