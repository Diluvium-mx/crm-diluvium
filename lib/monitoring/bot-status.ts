// ¿El bot está contestando? (Bloque C, 28-sep-2026). Lógica PURA y segura para el
// cliente: la alarma "bot callado" de los vigilantes, la pastilla "Bot" del Dashboard y
// la franja de la Bandeja. Los datos salen del CRM (lib/monitoring/bot-silence.ts);
// nada aquí llama a Zernio.
//
// Por qué existe: el 27–28 sep el bot pasó 16 h sin contestar (133 mensajes en 88
// chats) porque alguien le puso horario, y nada avisó.
import { describeSchedule, isWithinSchedule, scheduleLabel, type BotSchedule } from "@/lib/agente-ia/opciones";
import type { PillTone, StatusLine, PillStatus } from "./status-pill";
import { mazatlanTime } from "./zernio-account";

export type BotSilenceThresholds = {
  /** Minutos que un cliente espera sin respuesta (y sin ninguna respuesta del bot) para contar. */
  minutes: number;
  /** Conversaciones esperando a partir de las cuales se alerta. */
  conversations: number;
};

export const BOT_SILENCE_DEFAULTS: Readonly<BotSilenceThresholds> = Object.freeze({ minutes: 15, conversations: 3 });

/** Umbrales por variable (MONITOR_BOT_SILENCE_MINUTES / _CONVERSATIONS); un valor raro cae al de fábrica. */
export function botSilenceThresholds(env: Record<string, string | undefined>): BotSilenceThresholds {
  const int = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : fallback;
  };
  return {
    minutes: int(env.MONITOR_BOT_SILENCE_MINUTES, BOT_SILENCE_DEFAULTS.minutes),
    conversations: int(env.MONITOR_BOT_SILENCE_CONVERSATIONS, BOT_SILENCE_DEFAULTS.conversations),
  };
}

/**
 * ¿El horario estuvo abierto durante TODO el tramo? Al abrir, el bot reparte poco a poco
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
  /** Conversaciones cuyo último mensaje es del cliente, sin atender, de hace más de `minutes`. */
  waiting: { lastInboundAt: Date }[];
  /** Última respuesta del bot (cualquier conversación de la organización) en las últimas 24 h. */
  lastBotReplyAt: Date | null;
  /** Último cambio del horario en Opciones del bot (ai_config_changes), si hubo. */
  scheduleChangedAt?: Date | null;
};

/** Callado = horario abierto todo el tramo, ≥ N esperando y el bot sin mandar nada en el tramo. */
export function isBotSilent(input: BotSilenceInput): boolean {
  const { now, thresholds } = input;
  const span = thresholds.minutes * 60_000;
  if (!openThroughout(input.schedule, now, thresholds.minutes)) return false;
  // Horario recién cambiado (se abrió otro, o de horario a 24/7): el bot reparte lo
  // pendiente en 1–2 min; se espera el tramo completo antes de llamarlo "callado".
  if (input.scheduleChangedAt && now.getTime() - input.scheduleChangedAt.getTime() < span) return false;
  if (input.waiting.length < thresholds.conversations) return false;
  return input.lastBotReplyAt === null || now.getTime() - input.lastBotReplyAt.getTime() > span;
}

/** Texto del problema para el log y el issue (público): solo conteos y horas. */
export function botSilenceProblem(input: BotSilenceInput): string | null {
  if (!isBotSilent(input)) return null;
  const { now } = input;
  const oldest = input.waiting.reduce((min, w) => (w.lastInboundAt < min ? w.lastInboundAt : min), input.waiting[0].lastInboundAt);
  const last = input.lastBotReplyAt ? `a las ${mazatlanTime(input.lastBotReplyAt, now)}` : "ninguna en 24 h";
  return (
    `el bot no está contestando: ${input.waiting.length} conversación(es) esperan respuesta hace más de ` +
    `${input.thresholds.minutes} min (la más antigua desde las ${mazatlanTime(oldest, now)}, Mazatlán); ` +
    `última respuesta del bot: ${last}`
  );
}

// ── Pastilla "Bot" (Dashboard) y franja (Bandeja) ────────────────────────────

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
    label = off.length === channels.length ? "Bot apagado" : `Bot apagado en ${names(off)}`;
  } else if (!within) {
    tone = "amber";
    label = "Bot fuera de horario";
  } else if (silent) {
    tone = "red";
    label = "Bot callado";
  } else {
    tone = "green";
    label = "Bot contestando";
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
  const waiting = input.waiting.length;
  lines.push({
    label: `Sin respuesta hace más de ${thresholds.minutes} min`,
    value: `${waiting} conversación(es)`,
    tone: silent ? "red" : "neutral",
  });
  lines.push({
    label: "Última respuesta del bot",
    value: input.lastBotReplyAt ? ago(input.lastBotReplyAt, now) : "ninguna en 24 h",
    tone: "neutral",
  });
  return { tone, label, lines };
}

export type BotBannerLine = { tone: "red" | "amber" | "neutral"; text: string };
/** Lo que la página manda a la franja (lib/monitoring/bot-silence.ts → loadBotBanner). */
export type BotBannerData = { channels: BotChannel[]; schedule: BotSchedule | null };

/**
 * Franja de la Bandeja: solo si el bot tiene horario (no 24/7) o algún canal está
 * Apagado. Se recalcula en el navegador cada minuto (abre y cierra sin recargar).
 */
export function botBanner(input: BotBannerData & { now: Date }): BotBannerLine[] {
  const { channels, schedule, now } = input;
  if (channels.length === 0) return [];
  const off = channels.filter((c) => !c.on);
  const lines: BotBannerLine[] = [];
  if (off.length > 0) lines.push({ tone: "red", text: `El bot está apagado en ${names(off)}` });
  if (schedule && off.length < channels.length) {
    const within = isWithinSchedule(schedule, now);
    lines.push({
      tone: within ? "neutral" : "amber",
      text: `El bot solo contesta ${scheduleLabel(schedule)} (${within ? "ahora sí está contestando" : "ahora está fuera de horario"})`,
    });
  }
  return lines;
}
