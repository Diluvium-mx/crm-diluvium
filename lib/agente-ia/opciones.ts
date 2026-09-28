// Opciones del bot (sección "Opciones" de la pestaña Agente IA, 26-sep-2026). PURO y
// seguro para el cliente: tipos, valores de fábrica, validación (Zod), textos de ayuda
// y las reglas que comparten el web y el worker (horario en hora de Mazatlán, pausa
// tras respuesta humana, texto de cada cambio).
//
// REGLA DEL DUEÑO: los valores de fábrica son EXACTAMENTE el comportamiento anterior a
// esta sección (espera de 15 s, pausa por vendedor hasta "Activar", pedir asesor solo
// avisa, 24/7, lee imágenes y transcribe audios, respuesta balanceada en 2 mensajes,
// sin tope). Nada cambia hasta que alguien mueva una opción.
import { z } from "zod";
import { instantToLocal } from "@/lib/scheduled/rules";
import { returnLabel } from "./pause";

export const RESPONSE_LENGTHS = ["corta", "balanceada", "detallada"] as const;
export type ResponseLength = (typeof RESPONSE_LENGTHS)[number];

// Días ISO (1 = lunes … 7 = domingo) y horas "HH:MM" de Mazatlán. `to` menor o igual
// que `from` = horario que cruza la medianoche (p. ej. 20:00–02:00).
export type BotSchedule = { days: number[]; from: string; to: string };

export type BotOptions = {
  /** 1. Espera para juntar mensajes seguidos del cliente (5–60 s). */
  responseDelaySeconds: number;
  /** 2. Pausar el bot cuando un vendedor contesta. */
  pauseOnHumanReply: boolean;
  /** 2. Si se pausa: horas tras las que vuelve solo; null = nunca (a mano con "Activar"). */
  humanReplyReactivateHours: number | null;
  /** 3. Cuando el cliente pide un asesor: null = avisar y seguir; horas = avisar y pausar. */
  handoverPauseHours: number | null;
  /** 4. Horario del bot; null = 24/7. */
  schedule: BotSchedule | null;
  /** 5. Leer las imágenes del cliente. */
  readImages: boolean;
  /** 5. Transcribir las notas de voz del cliente. */
  transcribeAudio: boolean;
  /** 6. Longitud de la respuesta. */
  responseLength: ResponseLength;
  /** 6. Máximo de mensajes por respuesta. */
  maxBubbles: 1 | 2;
  /** 7. Tope de respuestas del bot por conversación; null = sin tope. */
  maxRepliesPerContact: number | null;
};

export type BotOptionField = keyof BotOptions;

export const BOT_OPTIONS_DEFAULTS: Readonly<BotOptions> = Object.freeze({
  responseDelaySeconds: 15,
  pauseOnHumanReply: true,
  humanReplyReactivateHours: null,
  handoverPauseHours: null,
  schedule: null,
  readImages: true,
  transcribeAudio: true,
  responseLength: "balanceada",
  maxBubbles: 2,
  maxRepliesPerContact: null,
});

export const MIN_DELAY_SECONDS = 5;
export const MAX_DELAY_SECONDS = 60;
export const MAX_PAUSE_HOURS = 24 * 30;
export const MAX_REPLIES_CAP = 1_000;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hours = z.number().int().min(1, "Mínimo 1 hora.").max(MAX_PAUSE_HOURS, "Máximo 30 días (720 horas).");

export const botScheduleSchema = z.object({
  days: z
    .array(z.number().int().min(1).max(7))
    .min(1, "Elige al menos un día.")
    .max(7)
    .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
  from: z.string().regex(HHMM, "Hora de inicio inválida."),
  to: z.string().regex(HHMM, "Hora de fin inválida."),
}).refine((s) => s.from !== s.to, { message: "La hora de inicio y la de fin no pueden ser iguales." });

// Lo que llega del cliente a la Server Action: un cambio a la vez (cada opción se guarda
// por separado), pero se acepta más de uno. Solo lo que viene se toca.
export const botOptionsPatchSchema = z
  .object({
    responseDelaySeconds: z.number().int().min(MIN_DELAY_SECONDS, `Mínimo ${MIN_DELAY_SECONDS} s.`).max(MAX_DELAY_SECONDS, `Máximo ${MAX_DELAY_SECONDS} s.`),
    pauseOnHumanReply: z.boolean(),
    humanReplyReactivateHours: hours.nullable(),
    handoverPauseHours: hours.nullable(),
    schedule: botScheduleSchema.nullable(),
    readImages: z.boolean(),
    transcribeAudio: z.boolean(),
    responseLength: z.enum(RESPONSE_LENGTHS),
    maxBubbles: z.union([z.literal(1), z.literal(2)]),
    maxRepliesPerContact: z.number().int().min(1, "Mínimo 1 respuesta.").max(MAX_REPLIES_CAP, `Máximo ${MAX_REPLIES_CAP.toLocaleString("es-MX")}.`).nullable(),
  })
  .partial()
  // Una llave presente con `undefined` (React Flight la conserva) no es un cambio: se quita
  // antes de contar, así nunca queda "15 s → undefined s" en el registro.
  .transform((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as typeof p)
  .refine((p) => Object.keys(p).length > 0, { message: "Nada que guardar." });

export type BotOptionsPatch = z.infer<typeof botOptionsPatchSchema>;

// ── Horario (hora de Mazatlán) ───────────────────────────────────────────────
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Día ISO (1 = lunes … 7 = domingo) de "YYYY-MM-DD" (aritmética de calendario, sin zona).
function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return js === 0 ? 7 : js;
}

/** ¿El bot contesta en este instante? Sin horario (null) siempre. */
export function isWithinSchedule(schedule: BotSchedule | null, now: Date): boolean {
  if (!schedule) return true;
  const local = instantToLocal(now); // "2026-09-26T10:00" en Mazatlán
  const day = isoWeekday(local.slice(0, 10));
  const minute = toMinutes(local.slice(11, 16));
  const from = toMinutes(schedule.from);
  const to = toMinutes(schedule.to);
  const days = new Set(schedule.days);
  if (from < to) return days.has(day) && minute >= from && minute < to;
  // Cruza la medianoche: la parte de la noche cuenta para el día en que empezó.
  const prev = day === 1 ? 7 : day - 1;
  return (days.has(day) && minute >= from) || (days.has(prev) && minute < to);
}

export const DAY_LABELS: Record<number, string> = { 1: "lun", 2: "mar", 3: "mié", 4: "jue", 5: "vie", 6: "sáb", 7: "dom" };

// "lun–vie 8:00–18:00 (hora de Mazatlán)", "lun, mié y vie 9:00–14:00 (hora de Mazatlán)".
export function describeSchedule(schedule: BotSchedule | null): string {
  if (!schedule) return "24/7";
  return `${scheduleLabel(schedule)} (hora de Mazatlán)`;
}

// Sin la zona: "lun–vie 8:00–18:00", "todos los días 8:00–20:00" (franja de la Bandeja).
export function scheduleLabel(schedule: BotSchedule): string {
  const hhmm = (t: string) => `${Number(t.slice(0, 2))}:${t.slice(3, 5)}`;
  const time = `${hhmm(schedule.from)}–${hhmm(schedule.to)}`;
  const days = [...new Set(schedule.days)].sort((a, b) => a - b);
  let label: string;
  if (days.length === 7) label = "todos los días";
  else if (days.length > 1 && days[days.length - 1] - days[0] === days.length - 1) label = `${DAY_LABELS[days[0]]}–${DAY_LABELS[days[days.length - 1]]}`;
  else if (days.length === 1) label = DAY_LABELS[days[0]];
  else label = `${days.slice(0, -1).map((d) => DAY_LABELS[d]).join(", ")} y ${DAY_LABELS[days[days.length - 1]]}`;
  return `${label} ${time}`;
}

// ── Pausa tras respuesta de un vendedor ─────────────────────────────────────
const HOUR_MS = 3_600_000;

/** Qué hacer cuando un vendedor contesta: no pausar, o pausar hasta `until` (null = hasta "Activar"). */
export function humanPauseUntil(options: Pick<BotOptions, "pauseOnHumanReply" | "humanReplyReactivateHours">, now: Date): { pause: false } | { pause: true; until: Date | null } {
  if (!options.pauseOnHumanReply) return { pause: false };
  const h = options.humanReplyReactivateHours;
  return { pause: true, until: h === null ? null : new Date(now.getTime() + h * HOUR_MS) };
}

/** Hasta cuándo se pausa el bot cuando el cliente pide un asesor (null = no se pausa). */
export function handoverPauseUntil(options: Pick<BotOptions, "handoverPauseHours">, now: Date): Date | null {
  return options.handoverPauseHours === null ? null : new Date(now.getTime() + options.handoverPauseHours * HOUR_MS);
}

// ── Textos ───────────────────────────────────────────────────────────────────
export const RESPONSE_LENGTH_LABELS: Record<ResponseLength, string> = {
  corta: "Corta",
  balanceada: "Balanceada",
  detallada: "Detallada",
};

export const OPTION_LABELS: Record<BotOptionField, string> = {
  responseDelaySeconds: "Tiempo de espera antes de responder",
  pauseOnHumanReply: "Pausar el bot cuando un vendedor contesta",
  humanReplyReactivateHours: "Reactivar solo después de",
  handoverPauseHours: "Cuando el cliente pide un asesor",
  schedule: "Horario del bot",
  readImages: "Responder imágenes",
  transcribeAudio: "Responder notas de voz",
  responseLength: "Longitud de respuesta",
  maxBubbles: "Máximo de mensajes por respuesta",
  maxRepliesPerContact: "Máximo de respuestas del bot por conversación",
};

// Ayuda en lenguaje simple + cómo está en GHL (Ángela), por opción.
export const OPTION_HELP: Record<BotOptionField, { help: string; ghl: string }> = {
  responseDelaySeconds: {
    help: "Cuando el cliente manda varios mensajes seguidos, el bot espera este tiempo desde el último para contestarlos todos juntos.",
    ghl: "10 s",
  },
  pauseOnHumanReply: {
    help: "Si un vendedor contesta en un chat (Bandeja, Embudo, programado o el celular), el bot se pausa ahí y deja de responder.",
    ghl: "Sí (se duerme cuando un asesor escribe)",
  },
  humanReplyReactivateHours: {
    help: "Cuánto tiempo después de que un vendedor tomó el chat el bot vuelve solo (se cuenta desde su primera respuesta; una pausa puesta a mano con «Pausar agente» se respeta). «Nunca» = solo con «Activar» en el Detalle del contacto.",
    ghl: "se reactiva a mano",
  },
  handoverPauseHours: {
    help: "Cuando el cliente pide hablar con una persona, el bot siempre deja el aviso 🤖 en la Bandeja. Aquí eliges si además se pausa en ese chat por un tiempo.",
    ghl: "avisa y se pausa 8 h",
  },
  schedule: {
    help: "Fuera de este horario el bot no contesta. Al abrir, atiende poco a poco los chats que quedaron con un mensaje del cliente sin respuesta (dentro de la ventana de 24 h).",
    ghl: "24/7",
  },
  readImages: {
    help: "Con «No», el bot ve «[imagen]» sin el contenido y no gasta en leerla (los comprobantes tampoco).",
    ghl: "Sí",
  },
  transcribeAudio: {
    help: "Con «No», el bot ve «[nota de voz]» sin el contenido y no gasta en transcribirla; el chat tampoco muestra la transcripción.",
    ghl: "Sí",
  },
  responseLength: {
    help: "Qué tan largas son las respuestas. Es una indicación breve que el CRM agrega; el Goal y las FAQs no se tocan.",
    ghl: "Balanceada",
  },
  maxBubbles: {
    help: "En cuántos mensajes de WhatsApp se manda cada respuesta (con 2, la información y la pregunta van separadas).",
    ghl: "1 (todo en un mensaje)",
  },
  maxRepliesPerContact: {
    help: "Al llegar al tope, el bot se pausa en ese chat hasta «Activar» y deja el aviso 🤖 «Llegó al máximo de respuestas» (tarjeta amarilla en el Embudo). Protege de un bucle con otro bot. Se cuenta desde el último «Activar».",
    ghl: "50",
  },
};

// Valor de una opción como texto (para el registro de cambios y la pantalla).
export function formatOptionValue(field: BotOptionField, value: unknown): string {
  switch (field) {
    case "responseDelaySeconds":
      return `${value} s`;
    case "pauseOnHumanReply":
    case "readImages":
    case "transcribeAudio":
      return value ? "Sí" : "No";
    case "humanReplyReactivateHours":
      return value === null ? "Nunca (a mano con «Activar»)" : `${value} h`;
    case "handoverPauseHours":
      return value === null ? "Avisar al vendedor y seguir contestando" : `Avisar y pausar el bot ${value} h`;
    case "schedule":
      return describeSchedule((value as BotSchedule | null) ?? null);
    case "responseLength":
      return RESPONSE_LENGTH_LABELS[value as ResponseLength] ?? String(value);
    case "maxBubbles":
      return String(value);
    case "maxRepliesPerContact":
      return value === null ? "Sin tope" : String(value);
  }
}

export type BotOptionsChange = { field: BotOptionField; oldValue: string | null; newValue: string | null; author: string | null; createdAt: Date };

/** "Daniel, hoy 11:20 · Tiempo de espera antes de responder: 15 s → 5 s". */
export function describeChange(c: BotOptionsChange, now: Date): string {
  const who = c.author?.trim() || "alguien";
  const when = returnLabel(c.createdAt, now);
  return `${who}, ${when} · ${OPTION_LABELS[c.field]}: ${c.oldValue ?? "—"} → ${c.newValue ?? "—"}`;
}

export function isBotOptionField(v: unknown): v is BotOptionField {
  return typeof v === "string" && Object.hasOwn(OPTION_LABELS, v);
}
