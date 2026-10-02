// ¿A qué hora sale cada intento de un seguimiento y por qué puerta? (docs/seguimientos.md §6,
// aprobado el 2-oct-2026). PURO: todo entra por parámetros (también "ahora").
//
// 1.er intento (casi todos los casos): texto del Agente IA ANTES DEL CIERRE de la ventana de
//   24 h, en la primera hora del caso que caiga después de 8 h de silencio y al menos 1 h antes
//   del cierre. Si ninguna cabe, la última hora permitida (7:00–21:00) antes del cierre. Si
//   tampoco, plantilla al día siguiente a la hora del caso.
//   Asesor sin respuesta: 2 h después. Pidió fecha: la que pidió (solo el día: 11:00; "al rato"
//   el mismo día: 3 h después).
// 2.º intento: día 2 desde la parada (pidió fecha: 2 días después del 1.º). 3.º: 7 días después
//   del 2.º. Con plantilla nunca dos en menos de 7 días al mismo contacto, nunca después de
//   las 19:00 (los casos de noche salen a las 18:00) y nunca antes de las 7:00.
import {
  ALLOWED_FROM,
  ALLOWED_TO,
  ASESOR_DELAY_MS,
  CASE_RULES,
  MIN_SILENCE_MS,
  OCUPADO_DELAY_MS,
  TEMPLATE_BY_DOOR,
  TEMPLATE_EVENING,
  TEMPLATE_LATEST,
  TEMPLATE_SPACING_DAYS,
  WINDOW_MARGIN_MS,
  type DoorKind,
  type FollowUpCase,
} from "./cases";
import { addDays, localMinutes, localParts, minutesOf, parseLocalDate, sameDate, zonedInstant, type LocalDate } from "./time";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type Door = "texto" | "plantilla";
export type AttemptPlan = { dueAt: Date; door: Door; templateName: string | null };

export type PlanInput = {
  caso: Exclude<FollowUpCase, "no_seguir">;
  /** Intento a programar: 1, 2 o 3. */
  intento: number;
  /** Zona del cliente (lib/followups/timezone.ts). */
  zone: string;
  /** Nuestro último mensaje (la parada). */
  stopAt: Date;
  /** Cierre de la ventana de 24 h (último mensaje del cliente + 24 h). */
  windowExpiresAt: Date | null;
  now: Date;
  fechaPedida?: string | null;
  horaPedida?: string | null;
  /** Cuándo salió el intento anterior. */
  prevAttemptAt?: Date | null;
  /** Última plantilla de seguimiento que salió a este contacto (7 días entre plantillas). */
  lastTemplateAt?: Date | null;
};

const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);
const dateOf = (t: Date, zone: string): LocalDate => {
  const p = localParts(t, zone);
  return { y: p.y, m: p.m, d: p.d };
};
const inAllowed = (t: Date, zone: string) => {
  const m = localMinutes(t, zone);
  return m >= minutesOf(ALLOWED_FROM) && m <= minutesOf(ALLOWED_TO);
};

/** Redondea a 5 minutos ("20:05", no "20:03"): hacia arriba o hacia abajo. */
function ceil5(t: Date): Date {
  const step = 5 * MINUTE;
  return new Date(Math.ceil(t.getTime() / step) * step);
}
function floor5(t: Date): Date {
  const step = 5 * MINUTE;
  return new Date(Math.floor(t.getTime() / step) * step);
}

/** ¿Se puede mandar texto libre a esa hora? (ventana abierta con 1 h de margen). */
export function windowOpenAt(windowExpiresAt: Date | null, t: Date): boolean {
  return windowExpiresAt !== null && t.getTime() <= windowExpiresAt.getTime() - WINDOW_MARGIN_MS;
}

/** Plantilla de una puerta a esa hora del cliente: saludo de la mañana antes de las 12:00. */
export function templateFor(door: DoorKind, t: Date, zone: string): string {
  if (door === "proteccion") return TEMPLATE_BY_DOOR.proteccion;
  return localMinutes(t, zone) < 12 * 60 ? TEMPLATE_BY_DOOR.saludoManana : TEMPLATE_BY_DOOR.saludoTarde;
}

/** Hora de una plantilla en ese caso: la del caso, o las 18:00 si el caso es de noche. */
export function templateTimeOf(caso: Exclude<FollowUpCase, "no_seguir">): string {
  const slot = CASE_RULES[caso].slot!;
  // Los casos de noche (empiezan a las 19:00 o después) mandan la plantilla a las 18:00.
  return minutesOf(slot.from) < minutesOf(TEMPLATE_LATEST) ? slot.from : TEMPLATE_EVENING;
}

/** Primer día (desde `from`) en que la hora `time` ya pasó `notBefore`. */
function firstAfter(zone: string, from: LocalDate, time: string, notBefore: Date): Date {
  let day = from;
  let t = zonedInstant(zone, day, time);
  for (let i = 0; i < 400 && t.getTime() <= notBefore.getTime(); i++) {
    day = addDays(day, 1);
    t = zonedInstant(zone, day, time);
  }
  return t;
}

/** Siguiente hora permitida a partir de `t` (la mañana siguiente a `morning` si ya es de noche). */
function nextAllowed(t: Date, zone: string, morning: string): Date {
  if (inAllowed(t, zone)) return t;
  const day = dateOf(t, zone);
  const sameDayMorning = zonedInstant(zone, day, morning);
  return localMinutes(t, zone) < minutesOf(ALLOWED_FROM) ? sameDayMorning : zonedInstant(zone, addDays(day, 1), morning);
}

function templatePlan(caso: PlanInput["caso"], intento: number, t: Date, zone: string): AttemptPlan {
  const door = CASE_RULES[caso].doors[intento - 1] ?? "saludo";
  return { dueAt: t, door: "plantilla", templateName: templateFor(door, t, zone) };
}

/** Plantilla a la hora del caso, el primer día desde `from` que no esté en el pasado ni rompa los 7 días. */
function templateOnOrAfter(input: PlanInput, from: LocalDate): AttemptPlan {
  const { caso, zone, now, lastTemplateAt } = input;
  const time = templateTimeOf(caso);
  let notBefore = now;
  if (lastTemplateAt) notBefore = maxDate(notBefore, new Date(lastTemplateAt.getTime() + TEMPLATE_SPACING_DAYS * DAY - MINUTE));
  return templatePlan(caso, input.intento, firstAfter(zone, from, time, notBefore), zone);
}

/** Texto o plantilla a una hora fija `t` (asesor y pidió fecha). */
function atFixedTime(input: PlanInput, t: Date, fallbackTime: string): AttemptPlan {
  const { zone, windowExpiresAt } = input;
  if (windowOpenAt(windowExpiresAt, t)) return { dueAt: t, door: "texto", templateName: null };
  // Plantilla: nunca después de las 19:00 ni a menos de 7 días de otra.
  let at = t;
  if (localMinutes(at, zone) > minutesOf(TEMPLATE_LATEST)) {
    const sameDay = zonedInstant(zone, dateOf(at, zone), TEMPLATE_LATEST);
    at = sameDay.getTime() > input.now.getTime() ? sameDay : zonedInstant(zone, addDays(dateOf(at, zone), 1), fallbackTime);
  }
  if (input.lastTemplateAt && at.getTime() < input.lastTemplateAt.getTime() + TEMPLATE_SPACING_DAYS * DAY) {
    return templateOnOrAfter(input, dateOf(new Date(input.lastTemplateAt.getTime() + TEMPLATE_SPACING_DAYS * DAY), zone));
  }
  return templatePlan(input.caso, input.intento, at, zone);
}

function firstAttempt(input: PlanInput): AttemptPlan {
  const { caso, zone, stopAt, windowExpiresAt, now } = input;
  const rule = CASE_RULES[caso];
  const soon = new Date(now.getTime() + MINUTE);

  if (caso === "asesor_sin_respuesta") {
    const t = nextAllowed(ceil5(maxDate(new Date(stopAt.getTime() + ASESOR_DELAY_MS), soon)), zone, "09:00");
    return atFixedTime(input, t, rule.slot!.from);
  }

  if (caso === "pidio_fecha") {
    const stopDay = dateOf(stopAt, zone);
    const day = (input.fechaPedida && parseLocalDate(input.fechaPedida)) || stopDay;
    let t: Date;
    if (input.horaPedida) {
      t = zonedInstant(zone, day, input.horaPedida);
      const m = localMinutes(t, zone);
      if (m < minutesOf(ALLOWED_FROM)) t = zonedInstant(zone, day, ALLOWED_FROM);
      else if (m > minutesOf(ALLOWED_TO)) t = zonedInstant(zone, day, ALLOWED_TO);
    } else if (sameDate(day, stopDay)) {
      // "Estoy ocupado" / "al rato": 3 h después, dentro del horario.
      t = nextAllowed(ceil5(new Date(stopAt.getTime() + OCUPADO_DELAY_MS)), zone, rule.slot!.from);
    } else {
      t = zonedInstant(zone, day, rule.slot!.from);
    }
    // La fecha ya pasó (lectura tardía): en cuanto se pueda.
    if (t.getTime() <= now.getTime()) t = nextAllowed(ceil5(soon), zone, rule.slot!.from);
    return atFixedTime(input, t, rule.slot!.from);
  }

  // Casos con franja: texto antes del cierre de la ventana.
  const slot = rule.slot!;
  const lo = maxDate(new Date(stopAt.getTime() + MIN_SILENCE_MS), soon);
  const hi = windowExpiresAt ? new Date(windowExpiresAt.getTime() - WINDOW_MARGIN_MS) : null;
  if (hi && hi.getTime() >= lo.getTime()) {
    for (let day = dateOf(lo, zone), i = 0; i < 3; day = addDays(day, 1), i++) {
      const start = zonedInstant(zone, day, slot.from);
      const end = zonedInstant(zone, day, slot.to);
      if (start.getTime() > hi.getTime()) break;
      let cand = maxDate(start, lo);
      if (cand.getTime() > end.getTime() || cand.getTime() > hi.getTime()) continue;
      const rounded = ceil5(cand);
      if (rounded.getTime() <= end.getTime() && rounded.getTime() <= hi.getTime()) cand = rounded;
      return { dueAt: cand, door: "texto", templateName: null };
    }
    // Ninguna hora del caso cabe: la última hora permitida antes del cierre.
    let t = hi;
    const m = localMinutes(hi, zone);
    if (m > minutesOf(ALLOWED_TO)) t = zonedInstant(zone, dateOf(hi, zone), ALLOWED_TO);
    else if (m < minutesOf(ALLOWED_FROM)) t = zonedInstant(zone, addDays(dateOf(hi, zone), -1), ALLOWED_TO);
    const neat = floor5(t);
    if (neat.getTime() >= lo.getTime()) return { dueAt: neat, door: "texto", templateName: null };
    if (t.getTime() >= lo.getTime()) return { dueAt: t, door: "texto", templateName: null };
  }
  // Tampoco: plantilla al día siguiente de la parada, a la hora del caso.
  return templateOnOrAfter(input, addDays(dateOf(stopAt, zone), 1));
}

function laterAttempt(input: PlanInput): AttemptPlan {
  const { caso, intento, zone, stopAt, windowExpiresAt } = input;
  const prev = input.prevAttemptAt ?? stopAt;
  const base =
    intento === 2
      ? caso === "pidio_fecha"
        ? addDays(dateOf(prev, zone), 2)
        : addDays(dateOf(stopAt, zone), 2)
      : addDays(dateOf(prev, zone), TEMPLATE_SPACING_DAYS);
  // Casi nunca sigue abierta (el cliente no ha escrito); si sí, texto a la hora del caso.
  const asText = zonedInstant(zone, base, CASE_RULES[caso].slot!.from);
  if (asText.getTime() > input.now.getTime() && windowOpenAt(windowExpiresAt, asText)) return { dueAt: asText, door: "texto", templateName: null };
  return templateOnOrAfter(input, base);
}

export function planAttempt(input: PlanInput): AttemptPlan {
  return input.intento <= 1 ? firstAttempt(input) : laterAttempt(input);
}

/** Intentos del caso; "pidió fecha" cuyo 1.º ya salió con plantilla se queda en 2 (§6). */
export function effectiveTotal(caso: FollowUpCase, firstDoor: Door | null): number {
  const total = CASE_RULES[caso].total;
  return caso === "pidio_fecha" && firstDoor === "plantilla" ? Math.min(total, 2) : total;
}

// ── Horario de los vendedores (sugerencias) ──────────────────────────────────
// De fábrica, de los datos de GHL (may–sep 2026): lunes a viernes 9:00–18:00 y sábado
// 9:00–13:00, hora de Mazatlán; domingo, nada. Editable en Agente IA › Seguimientos (Parte 4).
export const VENDOR_ZONE = "America/Mazatlan";
export type VendorShift = { from: string; to: string };
export const VENDOR_SHIFTS: Readonly<Record<number, VendorShift | null>> = {
  1: { from: "09:00", to: "18:00" },
  2: { from: "09:00", to: "18:00" },
  3: { from: "09:00", to: "18:00" },
  4: { from: "09:00", to: "18:00" },
  5: { from: "09:00", to: "18:00" },
  6: { from: "09:00", to: "13:00" },
  7: null,
};

function shiftOf(day: LocalDate): VendorShift | null {
  const weekday = localParts(zonedInstant(VENDOR_ZONE, day, "12:00"), VENDOR_ZONE).weekday;
  return VENDOR_SHIFTS[weekday] ?? null;
}

export function inVendorShift(t: Date): boolean {
  const day = dateOf(t, VENDOR_ZONE);
  const shift = shiftOf(day);
  if (!shift) return false;
  const m = localMinutes(t, VENDOR_ZONE);
  return m >= minutesOf(shift.from) && m < minutesOf(shift.to);
}

/**
 * Cuándo se le presenta al vendedor una sugerencia (chat con "Pausar agente" puesto a mano):
 * a su hora si cae en su turno; si no, en su última hora de trabajo antes (17:00 para uno de
 * las 20:00; el sábado a las 12:00 para uno del domingo). Nunca antes de "ahora".
 */
export function presentAtFor(dueAt: Date, now: Date): Date {
  if (inVendorShift(dueAt)) return maxDate(dueAt, now);
  const dueDay = dateOf(dueAt, VENDOR_ZONE);
  for (let k = 0; k <= 7; k++) {
    const day = addDays(dueDay, -k);
    const shift = shiftOf(day);
    if (!shift) continue;
    const end = zonedInstant(VENDOR_ZONE, day, shift.to);
    if (end.getTime() > dueAt.getTime()) continue;
    const start = zonedInstant(VENDOR_ZONE, day, shift.from);
    const lastHour = maxDate(new Date(end.getTime() - 60 * MINUTE), start);
    return maxDate(lastHour, now);
  }
  return maxDate(dueAt, now);
}
