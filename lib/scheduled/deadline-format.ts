// Formato corto, en hora de Mazatlán, del límite hasta el que se puede programar
// texto (🕒 Programar mensaje). Puro, para testearlo solo.
import { SCHEDULE_TIME_ZONE } from "./rules";


const hourFormat = new Intl.DateTimeFormat("es-MX", { timeZone: SCHEDULE_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
const weekdayFormat = new Intl.DateTimeFormat("es-MX", { timeZone: SCHEDULE_TIME_ZONE, weekday: "short" });
const dateFormat = new Intl.DateTimeFormat("es-MX", { timeZone: SCHEDULE_TIME_ZONE, day: "numeric", month: "short" });
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** "3:21 p.m." */
export function hourLabel(d: Date): string {
  return hourFormat.format(d).replace(/\s+/g, " ");
}

/** "mié" (sin punto). */
function weekdayLabel(d: Date): string {
  return weekdayFormat.format(d).replace(".", "");
}

/** "7 oct" (sin «de» ni punto). */
function dateLabel(d: Date): string {
  return dateFormat.format(d).replace(/\s+de\s+/g, " ").replace(".", "");
}

/** "mié 7 oct, 3:21 p.m." */
export function deadlineLong(d: Date): string {
  return `${weekdayLabel(d)} ${dateLabel(d)}, ${hourLabel(d)}`;
}

/** Para la etiqueta del interruptor: "3:21 p.m." (hoy) · "mié 3:21 p.m." (esta semana) · "13 oct 3:21 p.m.". */
export function deadlineShort(d: Date, now: Date = new Date()): string {
  if (dayKeyFormat.format(d) === dayKeyFormat.format(now)) return hourLabel(d);
  if (d.getTime() - now.getTime() < 6 * 24 * 60 * 60_000) return `${weekdayLabel(d)} ${hourLabel(d)}`;
  return `${dateLabel(d)} ${hourLabel(d)}`;
}
