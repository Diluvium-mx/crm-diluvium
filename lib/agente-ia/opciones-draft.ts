// Borrador de las Opciones del bot (botón «Guardar cambios», 27-sep-2026). PURO y seguro
// para el cliente. Todos los controles de la sección editan un BORRADOR local; nada se
// guarda hasta «Guardar cambios», que confirma con la lista de cambios («Tiempo de espera
// antes de responder: 15 s → 30 s», uno por línea) y manda SOLO los campos cambiados en
// una sola llamada a updateBotOptions (saveBotOptions deja un registro por campo).
//
// Los números (horas, tope) se editan como texto: un valor inválido no se pierde al
// escribir, solo deshabilita el botón y se dice por qué. Lo que está oculto (p. ej. las
// horas de reactivar con «Pausar el bot» = No) no cuenta ni se valida.
import {
  botOptionsPatchSchema,
  formatOptionValue,
  MAX_PAUSE_HOURS,
  MAX_REPLIES_CAP,
  OPTION_LABELS,
  type BotOptionField,
  type BotOptions,
  type BotOptionsPatch,
  type BotSchedule,
  type ResponseLength,
} from "./opciones";

export type ReactivateMode = "nunca" | "8" | "24" | "otro";

export type OptionsDraft = {
  responseDelaySeconds: number;
  pauseOnHumanReply: boolean;
  reactivateMode: ReactivateMode;
  reactivateHours: string;
  handoverMode: "avisar" | "pausar";
  handoverHours: string;
  scheduleMode: "siempre" | "horario";
  schedule: BotSchedule;
  readImages: boolean;
  transcribeAudio: boolean;
  seguimientosReal: boolean;
  responseLength: ResponseLength;
  maxBubbles: 1 | 2;
  maxRepliesMode: "sin_tope" | "tope";
  maxReplies: string;
};

// Valores con que aparece cada control al elegirlo por primera vez.
export const DEFAULT_SCHEDULE: BotSchedule = { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "18:00" };
const DEFAULT_REACTIVATE_HOURS = 12;
const DEFAULT_HANDOVER_HOURS = 8;
const DEFAULT_MAX_REPLIES = 50;

export function draftFromOptions(o: BotOptions): OptionsDraft {
  const h = o.humanReplyReactivateHours;
  return {
    responseDelaySeconds: o.responseDelaySeconds,
    pauseOnHumanReply: o.pauseOnHumanReply,
    reactivateMode: h === null ? "nunca" : h === 8 ? "8" : h === 24 ? "24" : "otro",
    reactivateHours: String(h ?? DEFAULT_REACTIVATE_HOURS),
    handoverMode: o.handoverPauseHours === null ? "avisar" : "pausar",
    handoverHours: String(o.handoverPauseHours ?? DEFAULT_HANDOVER_HOURS),
    scheduleMode: o.schedule === null ? "siempre" : "horario",
    schedule: o.schedule ? normalizeSchedule(o.schedule) : DEFAULT_SCHEDULE,
    readImages: o.readImages,
    transcribeAudio: o.transcribeAudio,
    seguimientosReal: o.seguimientosReal,
    responseLength: o.responseLength,
    maxBubbles: o.maxBubbles,
    maxRepliesMode: o.maxRepliesPerContact === null ? "sin_tope" : "tope",
    maxReplies: String(o.maxRepliesPerContact ?? DEFAULT_MAX_REPLIES),
  };
}

function normalizeSchedule(s: BotSchedule): BotSchedule {
  return { days: [...new Set(s.days)].sort((a, b) => a - b), from: s.from, to: s.to };
}

// Entero dentro del rango, escrito solo con dígitos ("08" vale; "8.5", "", "-1" no).
function parseWhole(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Valor que el borrador pide para cada opción, o por qué no se puede guardar.
function draftValues(d: OptionsDraft, saved: BotOptions): { values: BotOptions; errors: string[] } {
  const errors: string[] = [];
  const hoursRange = `un número entero de horas entre 1 y ${MAX_PAUSE_HOURS}`;

  let reactivate = saved.humanReplyReactivateHours;
  if (d.pauseOnHumanReply) {
    if (d.reactivateMode === "nunca") reactivate = null;
    else if (d.reactivateMode === "8" || d.reactivateMode === "24") reactivate = Number(d.reactivateMode);
    else {
      const n = parseWhole(d.reactivateHours, 1, MAX_PAUSE_HOURS);
      if (n === null) errors.push(`${OPTION_LABELS.humanReplyReactivateHours}: escribe ${hoursRange}.`);
      else reactivate = n;
    }
  }

  let handover: number | null = null;
  if (d.handoverMode === "pausar") {
    const n = parseWhole(d.handoverHours, 1, MAX_PAUSE_HOURS);
    if (n === null) {
      errors.push(`${OPTION_LABELS.handoverPauseHours}: escribe ${hoursRange}.`);
      handover = saved.handoverPauseHours;
    } else handover = n;
  }

  let schedule: BotSchedule | null = null;
  if (d.scheduleMode === "horario") {
    const s = normalizeSchedule(d.schedule);
    const problems: string[] = [];
    if (s.days.length === 0) problems.push("elige al menos un día");
    if (!HHMM.test(s.from) || !HHMM.test(s.to)) problems.push("escribe la hora de inicio y la de fin");
    else if (s.from === s.to) problems.push("la hora de inicio y la de fin no pueden ser iguales");
    if (problems.length) {
      errors.push(`${OPTION_LABELS.schedule}: ${problems.join("; ")}.`);
      schedule = saved.schedule;
    } else schedule = s;
  }

  let maxReplies: number | null = null;
  if (d.maxRepliesMode === "tope") {
    const n = parseWhole(d.maxReplies, 1, MAX_REPLIES_CAP);
    if (n === null) {
      errors.push(`${OPTION_LABELS.maxRepliesPerContact}: escribe un número entero entre 1 y ${MAX_REPLIES_CAP.toLocaleString("es-MX")}.`);
      maxReplies = saved.maxRepliesPerContact;
    } else maxReplies = n;
  }

  return {
    values: {
      responseDelaySeconds: d.responseDelaySeconds,
      pauseOnHumanReply: d.pauseOnHumanReply,
      humanReplyReactivateHours: reactivate,
      handoverPauseHours: handover,
      schedule,
      readImages: d.readImages,
      transcribeAudio: d.transcribeAudio,
      seguimientosReal: d.seguimientosReal,
      responseLength: d.responseLength,
      maxBubbles: d.maxBubbles,
      maxRepliesPerContact: maxReplies,
    },
    errors,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Orden de la pantalla (el mismo de OPTION_LABELS).
const FIELDS = Object.keys(OPTION_LABELS) as BotOptionField[];

export type DraftPatch = {
  /** Solo los campos que cambiaron (vacío = nada que guardar). */
  patch: BotOptionsPatch;
  /** Por qué no se puede guardar (vacío = se puede). */
  errors: string[];
  /** Hay algo distinto de lo guardado (aunque sea inválido): muestra «Guardar cambios»/«Descartar». */
  dirty: boolean;
};

/** Borrador → lo que se manda a updateBotOptions (solo lo cambiado) y si se puede guardar. */
export function draftToPatch(saved: BotOptions, d: OptionsDraft): DraftPatch {
  const { values, errors } = draftValues(d, saved);
  const patch: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const before = field === "schedule" && saved.schedule ? normalizeSchedule(saved.schedule) : saved[field];
    if (!same(before, values[field])) patch[field] = values[field];
  }
  const typed = patch as BotOptionsPatch;
  const all = [...errors];
  // Red de seguridad: lo mismo que valida el servidor.
  if (all.length === 0 && Object.keys(typed).length > 0) {
    const check = botOptionsPatchSchema.safeParse(typed);
    if (!check.success) all.push(check.error.issues[0]?.message ?? "Hay un valor no válido.");
  }
  return { patch: typed, errors: all, dirty: Object.keys(typed).length > 0 || all.length > 0 };
}

/** «Tiempo de espera antes de responder: 15 s → 30 s», uno por campo cambiado, en el orden de la pantalla. */
export function describePatch(saved: BotOptions, patch: BotOptionsPatch): string[] {
  return FIELDS.filter((f) => Object.hasOwn(patch, f)).map(
    (f) => `${OPTION_LABELS[f]}: ${formatOptionValue(f, saved[f])} → ${formatOptionValue(f, patch[f])}`,
  );
}
