// ¿El Agente IA está contestando? (Bloque C, 28-sep-2026). Lógica PURA y segura para el
// cliente: la alarma "Agente IA callado" de los vigilantes, la pastilla "Agente IA" del
// Dashboard y la franja de la Bandeja. Los datos salen del CRM (lib/monitoring/bot-silence.ts);
// nada aquí llama a Zernio.
//
// Por qué existe: el 27–28 sep el Agente IA pasó 16 h sin contestar (133 mensajes en 88
// chats) porque alguien le puso horario, y nada avisó.
//
// Bloque E (28-sep): la alarma cuenta solo lo RECIENTE (el cliente escribió en la última
// hora). El Agente IA solo recupera por su cuenta lo de los últimos 30 min (sweep.ts), así que lo
// atrasado (p. ej. los 74 chats del horario mié–jue) ya no lo va a contestar: no es "callado",
// es trabajo de un vendedor, y sale como dato en la pastilla.
import { describeSchedule, isWithinSchedule, scheduleLabel, type BotSchedule } from "@/lib/agente-ia/opciones";
import type { PillTone, StatusLine, PillStatus } from "./status-pill";
import { mazatlanTime } from "./zernio-account";

export type BotSilenceThresholds = {
  /** Minutos que un cliente espera sin respuesta (y sin ninguna respuesta del Agente IA) para contar. */
  minutes: number;
  /** Conversaciones esperando a partir de las cuales se alerta. */
  conversations: number;
  /** Solo cuenta si el último mensaje del cliente llegó en estos minutos; lo más viejo es "atrasado". */
  recentMinutes: number;
};

export const BOT_SILENCE_DEFAULTS: Readonly<BotSilenceThresholds> = Object.freeze({ minutes: 15, conversations: 3, recentMinutes: 60 });

/**
 * Umbrales por variable (MONITOR_BOT_SILENCE_MINUTES / _CONVERSATIONS / _RECENT_MINUTES); un
 * valor raro cae al de fábrica. La ventana de "reciente" tiene que ser mayor que la espera: si
 * no, nada contaría nunca (entonces se usa 4 veces la espera, 60 con los de fábrica).
 */
export function botSilenceThresholds(env: Record<string, string | undefined>): BotSilenceThresholds {
  const int = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : fallback;
  };
  const minutes = int(env.MONITOR_BOT_SILENCE_MINUTES, BOT_SILENCE_DEFAULTS.minutes);
  const recent = int(env.MONITOR_BOT_SILENCE_RECENT_MINUTES, BOT_SILENCE_DEFAULTS.recentMinutes);
  return {
    minutes,
    conversations: int(env.MONITOR_BOT_SILENCE_CONVERSATIONS, BOT_SILENCE_DEFAULTS.conversations),
    recentMinutes: recent > minutes ? recent : minutes * 4,
  };
}

/**
 * ¿El horario estuvo abierto durante TODO el tramo? Al abrir, el Agente IA reparte poco a poco
 * lo que llegó con el horario cerrado: eso no es "callado" hasta que pase el tramo.
 */
export function openThroughout(schedule: BotSchedule | null, now: Date, minutes: number): boolean {
  for (let m = 0; m <= minutes; m++) {
    if (!isWithinSchedule(schedule, new Date(now.getTime() - m * 60_000))) return false;
  }
  return true;
}

export type BotSilenceInput = {
  now: Date;
  thresholds: BotSilenceThresholds;
  schedule: BotSchedule | null;
  /**
   * Conversaciones cuyo último mensaje es del cliente, sin atender, de hace más de `minutes`
   * (hasta 24 h: la ventana de WhatsApp). Se parten en recientes y atrasadas con splitWaiting.
   */
  waiting: { lastInboundAt: Date }[];
  /** Última respuesta del Agente IA (cualquier conversación de la organización) en las últimas 24 h. */
  lastBotReplyAt: Date | null;
  /** Último cambio del horario en Opciones del Agente IA (ai_config_changes), si hubo. */
  scheduleChangedAt?: Date | null;
};

/**
 * Recientes = el cliente escribió en la última hora y espera más de `minutes` (esto sí alarma).
 * Atrasadas = escribió hace más de una hora: el Agente IA ya no las recupera solo; esperan a un
 * vendedor (dato de la pastilla, nunca alarma).
 */
export function splitWaiting<T extends { lastInboundAt: Date }>(
  waiting: T[],
  now: Date,
  thresholds: BotSilenceThresholds,
): { recent: T[]; backlog: T[] } {
  const recentFrom = now.getTime() - thresholds.recentMinutes * 60_000;
  const waitedFrom = now.getTime() - thresholds.minutes * 60_000;
  const recent: T[] = [];
  const backlog: T[] = [];
  for (const w of waiting) {
    const at = w.lastInboundAt.getTime();
    if (at < recentFrom) backlog.push(w);
    else if (at < waitedFrom) recent.push(w);
  }
  return { recent, backlog };
}

/** Callado = horario abierto todo el tramo, ≥ N recientes esperando y el Agente IA sin mandar nada en el tramo. */
export function isBotSilent(input: BotSilenceInput): boolean {
  const { now, thresholds } = input;
  const span = thresholds.minutes * 60_000;
  if (!openThroughout(input.schedule, now, thresholds.minutes)) return false;
  // Horario recién cambiado (se abrió otro, o de horario a 24/7): el Agente IA reparte lo
  // pendiente en 1–2 min; se espera el tramo completo antes de llamarlo "callado".
  if (input.scheduleChangedAt && now.getTime() - input.scheduleChangedAt.getTime() < span) return false;
  if (splitWaiting(input.waiting, now, thresholds).recent.length < thresholds.conversations) return false;
  return input.lastBotReplyAt === null || now.getTime() - input.lastBotReplyAt.getTime() > span;
}

/** Texto del problema para el log y el issue (público): solo conteos y horas. */
export function botSilenceProblem(input: BotSilenceInput): string | null {
  if (!isBotSilent(input)) return null;
  const { now, thresholds } = input;
  const { recent } = splitWaiting(input.waiting, now, thresholds);
  const oldest = recent.reduce((min, w) => (w.lastInboundAt < min ? w.lastInboundAt : min), recent[0].lastInboundAt);
  const last = input.lastBotReplyAt ? `a las ${mazatlanTime(input.lastBotReplyAt, now)}` : "ninguna en 24 h";
  return (
    `el Agente IA no está contestando: ${recent.length} cliente(s) escribieron en la última ` +
    `${windowText(thresholds.recentMinutes)} y esperan respuesta hace más de ${thresholds.minutes} min ` +
    `(el más antiguo desde las ${mazatlanTime(oldest, now)}, Mazatlán); última respuesta del Agente IA: ${last}`
  );
}

/** "hora" con los de fábrica; "90 min" si se cambió la variable. */
function windowText(minutes: number): string {
  return minutes === 60 ? "hora" : `${minutes} min`;
}

/** "1 chat espera a un vendedor" / "74 chats esperan a un vendedor". */
export function backlogText(count: number): string {
  return count === 1 ? "1 chat espera a un vendedor" : `${count} chats esperan a un vendedor`;
}

// ── Pastilla "Agente IA" (Dashboard) y franja (Bandeja) ────────────────────────────

export type BotChannel = { displayName: string; on: boolean };

function names(list: BotChannel[]): string {
  const n = list.map((c) => c.displayName);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

/**
 * Pastilla del Dashboard: verde contestando, ámbar fuera de horario, rojo apagado o
 * callado. null sin canales de WhatsApp vigentes.
 */
export function botStatus(input: BotSilenceInput & { channels: BotChannel[] }): PillStatus | null {
  const { now, channels, schedule, thresholds } = input;
  if (channels.length === 0) return null;
  const off = channels.filter((c) => !c.on);
  const within = isWithinSchedule(schedule, now);
  const silent = off.length < channels.length && isBotSilent(input);

  let tone: PillTone;
  let label: string;
  if (off.length > 0) {
    tone = "red";
    label = off.length === channels.length ? "Agente IA apagado" : `Agente IA apagado en ${names(off)}`;
  } else if (!within) {
    tone = "amber";
    label = "Agente IA fuera de horario";
  } else if (silent) {
    tone = "red";
    label = "Agente IA callado";
  } else {
    tone = "green";
    label = "Agente IA contestando";
  }

  const single = channels.length === 1;
  const lines: StatusLine[] = channels.map((c) => ({
    label: single ? "Canal" : `Canal ${c.displayName}`,
    value: c.on ? "Encendido" : "Apagado",
    tone: c.on ? "green" : "red",
  }));
  lines.push({
    label: "Horario",
    value: schedule ? `${describeSchedule(schedule)}${within ? "" : " · ahora fuera de horario"}` : "24/7",
    tone: within ? "neutral" : "amber",
  });
  const { recent, backlog } = splitWaiting(input.waiting, now, thresholds);
  lines.push({
    label: `Sin respuesta hace más de ${thresholds.minutes} min (de la última ${windowText(thresholds.recentMinutes)})`,
    value: `${recent.length} conversación(es)`,
    tone: silent ? "red" : "neutral",
  });
  // Lo atrasado no alarma: es un dato para que un vendedor lo atienda.
  lines.push({
    label: `Atrasados (más de ${thresholds.recentMinutes === 60 ? "1 h" : `${thresholds.recentMinutes} min`})`,
    value: backlogText(backlog.length),
    tone: "neutral",
  });
  lines.push({
    label: "Última respuesta del Agente IA",
    value: input.lastBotReplyAt ? ago(input.lastBotReplyAt, now) : "ninguna en 24 h",
    tone: "neutral",
  });
  return { tone, label, lines };
}

export type BotBannerLine = { tone: "red" | "amber" | "neutral"; text: string };
/** Lo que la página manda a la franja (lib/monitoring/bot-silence.ts → loadBotBanner). */
export type BotBannerData = { channels: BotChannel[]; schedule: BotSchedule | null };

/**
 * Franja de la Bandeja: solo si el Agente IA tiene horario (no 24/7) o algún canal está
 * Apagado. Se recalcula en el navegador cada minuto (abre y cierra sin recargar).
 */
export function botBanner(input: BotBannerData & { now: Date }): BotBannerLine[] {
  const { channels, schedule, now } = input;
  if (channels.length === 0) return [];
  const off = channels.filter((c) => !c.on);
  const lines: BotBannerLine[] = [];
  if (off.length > 0) lines.push({ tone: "red", text: `El Agente IA está apagado en ${names(off)}` });
  if (schedule && off.length < channels.length) {
    const within = isWithinSchedule(schedule, now);
    lines.push({
      tone: within ? "neutral" : "amber",
      text: `El Agente IA solo contesta ${scheduleLabel(schedule)} (${within ? "ahora sí está contestando" : "ahora está fuera de horario"})`,
    });
  }
  return lines;
}
