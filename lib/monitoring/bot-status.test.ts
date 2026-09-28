// "¿El Agente IA está contestando?" (Bloque C, puro): umbrales por variable, la regla de
// "Agente IA callado", la pastilla "Agente IA" del Dashboard y la franja de la Bandeja.
// Bloque E: solo alarma lo reciente (el cliente escribió en la última hora).
import { describe, expect, it } from "vitest";
import type { BotSchedule } from "@/lib/agente-ia/opciones";
import {
  BOT_SILENCE_DEFAULTS,
  botBanner,
  botSilenceProblem,
  botSilenceThresholds,
  botStatus,
  isBotSilent,
  openThroughout,
  splitWaiting,
  type BotSilenceInput,
} from "./bot-status";

const MIN = 60_000;
// Martes 29-sep-2026 12:00 en Mazatlán (UTC−7).
const NOW = new Date("2026-09-29T19:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);
// El horario que dejó al Agente IA 16 h callado el 27–28 sep.
const MIE_JUE_NOCHE: BotSchedule = { days: [3, 4], from: "20:00", to: "06:00" };

function input(over: Partial<BotSilenceInput> = {}): BotSilenceInput {
  return {
    now: NOW,
    thresholds: { ...BOT_SILENCE_DEFAULTS },
    schedule: null,
    waiting: [{ lastInboundAt: ago(40) }, { lastInboundAt: ago(25) }, { lastInboundAt: ago(18) }],
    lastBotReplyAt: ago(60),
    ...over,
  };
}

describe("umbrales (MONITOR_BOT_SILENCE_MINUTES / _CONVERSATIONS / _RECENT_MINUTES)", () => {
  it("de fábrica: 15 min, 3 conversaciones y solo lo de la última hora", () => {
    expect(botSilenceThresholds({})).toEqual({ minutes: 15, conversations: 3, recentMinutes: 60 });
  });
  it("se cambian por variable; un valor raro cae al de fábrica", () => {
    expect(
      botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: "30", MONITOR_BOT_SILENCE_CONVERSATIONS: "5", MONITOR_BOT_SILENCE_RECENT_MINUTES: "90" }),
    ).toEqual({ minutes: 30, conversations: 5, recentMinutes: 90 });
    expect(botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: "0", MONITOR_BOT_SILENCE_CONVERSATIONS: "abc", MONITOR_BOT_SILENCE_RECENT_MINUTES: "-1" })).toEqual({
      minutes: 15,
      conversations: 3,
      recentMinutes: 60,
    });
    expect(botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: " ", MONITOR_BOT_SILENCE_CONVERSATIONS: "2.5" })).toEqual({ minutes: 15, conversations: 3, recentMinutes: 60 });
  });
  it("la ventana de 'reciente' no puede ser menor que la espera (nada contaría): 4 veces la espera", () => {
    expect(botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: "30", MONITOR_BOT_SILENCE_RECENT_MINUTES: "20" }).recentMinutes).toBe(120);
    expect(botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: "90" }).recentMinutes).toBe(360);
  });
});

describe("recientes y atrasados (Bloque E: sin falsas alarmas de noche)", () => {
  // Los 74 chats del horario mié–jue: el cliente escribió hace 2 a 20 h y nadie contestó.
  const atrasados = Array.from({ length: 74 }, (_, i) => ({ lastInboundAt: ago(120 + i * 15) }));
  // 3 clientes nuevos: escribieron hace 16, 30 y 59 min.
  const nuevos = [{ lastInboundAt: ago(16) }, { lastInboundAt: ago(30) }, { lastInboundAt: ago(59) }];

  it("74 chats viejos + noche sin mensajes (el Agente IA no manda nada en horas) → NO suena", () => {
    const i = input({ waiting: atrasados, lastBotReplyAt: ago(8 * 60) });
    expect(isBotSilent(i)).toBe(false);
    expect(botSilenceProblem(i)).toBeNull();
    expect(splitWaiting(atrasados, NOW, BOT_SILENCE_DEFAULTS)).toMatchObject({ recent: [], backlog: atrasados });
  });

  it("3 clientes nuevos sin respuesta más de 15 min (y los 74 viejos) → SUENA, y cuenta solo los 3", () => {
    const i = input({ waiting: [...atrasados, ...nuevos], lastBotReplyAt: ago(8 * 60) });
    expect(isBotSilent(i)).toBe(true);
    expect(botSilenceProblem(i)).toMatch(/^el Agente IA no está contestando: 3 cliente\(s\) escribieron en la última hora/);
    expect(isBotSilent(input({ waiting: nuevos, lastBotReplyAt: null }))).toBe(true);
  });

  it("el borde: escribió hace 60 min justos cuenta; hace 61 ya es atrasado", () => {
    const { recent, backlog } = splitWaiting([{ lastInboundAt: ago(60) }, { lastInboundAt: ago(61) }], NOW, BOT_SILENCE_DEFAULTS);
    expect(recent).toHaveLength(1);
    expect(backlog).toHaveLength(1);
    expect(isBotSilent(input({ waiting: [{ lastInboundAt: ago(61) }, { lastInboundAt: ago(40) }, { lastInboundAt: ago(20) }] }))).toBe(false);
  });

  it("la pastilla dice los atrasados como dato ('N chats esperan a un vendedor'), sin ponerse roja", () => {
    const s = botStatus({ ...input({ waiting: atrasados, lastBotReplyAt: ago(8 * 60) }), channels: [{ displayName: "WhatsApp Diluvium", on: true }] });
    expect(s).toMatchObject({ tone: "green", label: "Agente IA contestando" });
    expect(s?.lines).toContainEqual({ label: "Atrasados (más de 1 h)", value: "74 chats esperan a un vendedor", tone: "neutral" });
    const uno = botStatus({ ...input({ waiting: [{ lastInboundAt: ago(90) }] }), channels: [{ displayName: "WhatsApp Diluvium", on: true }] });
    expect(uno?.lines).toContainEqual({ label: "Atrasados (más de 1 h)", value: "1 chat espera a un vendedor", tone: "neutral" });
  });
});

describe("Agente IA callado", () => {
  it("24/7, 3 clientes esperando más de 15 min y el Agente IA sin mandar nada en 15 min → callado", () => {
    expect(isBotSilent(input())).toBe(true);
    expect(isBotSilent(input({ lastBotReplyAt: null }))).toBe(true);
  });

  it("menos de 3 esperando no alerta", () => {
    expect(isBotSilent(input({ waiting: [{ lastInboundAt: ago(40) }, { lastInboundAt: ago(20) }] }))).toBe(false);
  });

  it("si el Agente IA mandó algo en los últimos 15 min, no está callado (está contestando a otros)", () => {
    expect(isBotSilent(input({ lastBotReplyAt: ago(5) }))).toBe(false);
    expect(isBotSilent(input({ lastBotReplyAt: ago(15) }))).toBe(false);
    expect(isBotSilent(input({ lastBotReplyAt: ago(16) }))).toBe(true);
  });

  it("fuera del horario del Agente IA no es 'callado' (lo avisan la franja y la pastilla ámbar)", () => {
    expect(isBotSilent(input({ schedule: MIE_JUE_NOCHE }))).toBe(false);
  });

  it("recién abierto el horario: espera el tramo completo (reparte lo acumulado)", () => {
    const desdeLas1150: BotSchedule = { days: [1, 2, 3, 4, 5], from: "11:50", to: "18:00" };
    const desdeLas1140: BotSchedule = { days: [1, 2, 3, 4, 5], from: "11:40", to: "18:00" };
    expect(openThroughout(desdeLas1150, NOW, 15)).toBe(false);
    expect(isBotSilent(input({ schedule: desdeLas1150 }))).toBe(false);
    expect(openThroughout(desdeLas1140, NOW, 15)).toBe(true);
    expect(isBotSilent(input({ schedule: desdeLas1140 }))).toBe(true);
  });

  it("horario recién cambiado (p. ej. de horario a 24/7): espera el tramo completo; después sí alerta", () => {
    expect(isBotSilent(input({ scheduleChangedAt: ago(10) }))).toBe(false);
    expect(isBotSilent(input({ scheduleChangedAt: ago(16) }))).toBe(true);
  });

  it("el texto del problema lleva solo conteos y horas (el issue es público)", () => {
    expect(botSilenceProblem(input())).toBe(
      "el Agente IA no está contestando: 3 cliente(s) escribieron en la última hora y esperan respuesta hace más de 15 min " +
        "(el más antiguo desde las 11:20, Mazatlán); última respuesta del Agente IA: a las 11:00",
    );
    expect(botSilenceProblem(input({ lastBotReplyAt: null }))).toMatch(/última respuesta del Agente IA: ninguna en 24 h$/);
    expect(botSilenceProblem(input({ lastBotReplyAt: ago(1) }))).toBeNull();
  });
});

describe("pastilla 'Agente IA' del Dashboard", () => {
  const encendido = [{ displayName: "WhatsApp Diluvium", on: true }];

  it("verde contestando (24/7, nadie esperando de más)", () => {
    const s = botStatus({ ...input({ waiting: [] }), channels: encendido });
    expect(s).toMatchObject({ tone: "green", label: "Agente IA contestando" });
    expect(s?.lines).toEqual([
      { label: "Canal", value: "Encendido", tone: "green" },
      { label: "Horario", value: "24/7", tone: "neutral" },
      { label: "Sin respuesta hace más de 15 min (de la última hora)", value: "0 conversación(es)", tone: "neutral" },
      { label: "Atrasados (más de 1 h)", value: "0 chats esperan a un vendedor", tone: "neutral" },
      { label: "Última respuesta del Agente IA", value: "hace 1 h", tone: "neutral" },
    ]);
  });

  it("ámbar fuera de horario", () => {
    const s = botStatus({ ...input({ schedule: MIE_JUE_NOCHE }), channels: encendido });
    expect(s).toMatchObject({ tone: "amber", label: "Agente IA fuera de horario" });
    expect(s?.lines[1]).toEqual({ label: "Horario", value: "mié–jue 20:00–6:00 (hora de Mazatlán) · ahora fuera de horario", tone: "amber" });
  });

  it("rojo apagado (gana a todo lo demás)", () => {
    const s = botStatus({ ...input({ schedule: MIE_JUE_NOCHE }), channels: [{ displayName: "WhatsApp Diluvium", on: false }] });
    expect(s).toMatchObject({ tone: "red", label: "Agente IA apagado" });
    expect(s?.lines[0]).toEqual({ label: "Canal", value: "Apagado", tone: "red" });
  });

  it("rojo callado", () => {
    const s = botStatus({ ...input(), channels: encendido });
    expect(s).toMatchObject({ tone: "red", label: "Agente IA callado" });
    expect(s?.lines[2]).toEqual({ label: "Sin respuesta hace más de 15 min (de la última hora)", value: "3 conversación(es)", tone: "red" });
  });

  it("sin canales de WhatsApp: no hay pastilla", () => {
    expect(botStatus({ ...input(), channels: [] })).toBeNull();
  });
});

describe("franja de la Bandeja", () => {
  const encendido = [{ displayName: "WhatsApp Diluvium", on: true }];

  it("24/7 y Encendido: no hay franja", () => {
    expect(botBanner({ channels: encendido, schedule: null, now: NOW })).toEqual([]);
  });

  it("con horario: dice cuándo contesta y si ahora está fuera", () => {
    expect(botBanner({ channels: encendido, schedule: MIE_JUE_NOCHE, now: NOW })).toEqual([
      { tone: "amber", text: "El Agente IA solo contesta mié–jue 20:00–6:00 (ahora está fuera de horario)" },
    ]);
    // Miércoles 30-sep 21:00 en Mazatlán.
    expect(botBanner({ channels: encendido, schedule: MIE_JUE_NOCHE, now: new Date("2026-10-01T04:00:00Z") })).toEqual([
      { tone: "neutral", text: "El Agente IA solo contesta mié–jue 20:00–6:00 (ahora sí está contestando)" },
    ]);
  });

  it("canal Apagado: lo dice (y el horario ya no importa)", () => {
    expect(botBanner({ channels: [{ displayName: "WhatsApp Diluvium", on: false }], schedule: MIE_JUE_NOCHE, now: NOW })).toEqual([
      { tone: "red", text: "El Agente IA está apagado en WhatsApp Diluvium" },
    ]);
  });
});
