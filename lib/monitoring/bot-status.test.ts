// "¿El bot está contestando?" (Bloque C, puro): umbrales por variable, la regla de
// "bot callado", la pastilla "Bot" del Dashboard y la franja de la Bandeja.
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
  type BotSilenceInput,
} from "./bot-status";

const MIN = 60_000;
// Martes 29-sep-2026 12:00 en Mazatlán (UTC−7).
const NOW = new Date("2026-09-29T19:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);
// El horario que dejó al bot 16 h callado el 27–28 sep.
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

describe("umbrales (MONITOR_BOT_SILENCE_MINUTES / _CONVERSATIONS)", () => {
  it("de fábrica: 15 min y 3 conversaciones", () => {
    expect(botSilenceThresholds({})).toEqual({ minutes: 15, conversations: 3 });
  });
  it("se cambian por variable; un valor raro cae al de fábrica", () => {
    expect(botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: "30", MONITOR_BOT_SILENCE_CONVERSATIONS: "5" })).toEqual({ minutes: 30, conversations: 5 });
    expect(botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: "0", MONITOR_BOT_SILENCE_CONVERSATIONS: "abc" })).toEqual({ minutes: 15, conversations: 3 });
    expect(botSilenceThresholds({ MONITOR_BOT_SILENCE_MINUTES: " ", MONITOR_BOT_SILENCE_CONVERSATIONS: "2.5" })).toEqual({ minutes: 15, conversations: 3 });
  });
});

describe("bot callado", () => {
  it("24/7, 3 clientes esperando más de 15 min y el bot sin mandar nada en 15 min → callado", () => {
    expect(isBotSilent(input())).toBe(true);
    expect(isBotSilent(input({ lastBotReplyAt: null }))).toBe(true);
  });

  it("menos de 3 esperando no alerta", () => {
    expect(isBotSilent(input({ waiting: [{ lastInboundAt: ago(40) }, { lastInboundAt: ago(20) }] }))).toBe(false);
  });

  it("si el bot mandó algo en los últimos 15 min, no está callado (está contestando a otros)", () => {
    expect(isBotSilent(input({ lastBotReplyAt: ago(5) }))).toBe(false);
    expect(isBotSilent(input({ lastBotReplyAt: ago(15) }))).toBe(false);
    expect(isBotSilent(input({ lastBotReplyAt: ago(16) }))).toBe(true);
  });

  it("fuera del horario del bot no es 'callado' (lo avisan la franja y la pastilla ámbar)", () => {
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

  it("el texto del problema lleva solo conteos y horas (el issue es público)", () => {
    expect(botSilenceProblem(input())).toBe(
      "el bot no está contestando: 3 conversación(es) esperan respuesta hace más de 15 min " +
        "(la más antigua desde las 11:20, Mazatlán); última respuesta del bot: a las 11:00",
    );
    expect(botSilenceProblem(input({ lastBotReplyAt: null }))).toMatch(/última respuesta del bot: ninguna en 24 h$/);
    expect(botSilenceProblem(input({ lastBotReplyAt: ago(1) }))).toBeNull();
  });
});

describe("pastilla 'Bot' del Dashboard", () => {
  const encendido = [{ displayName: "WhatsApp Diluvium", on: true }];

  it("verde contestando (24/7, nadie esperando de más)", () => {
    const s = botStatus({ ...input({ waiting: [] }), channels: encendido });
    expect(s).toMatchObject({ tone: "green", label: "Bot contestando" });
    expect(s?.lines).toEqual([
      { label: "Canal", value: "Encendido", tone: "green" },
      { label: "Horario", value: "24/7", tone: "neutral" },
      { label: "Sin respuesta hace más de 15 min", value: "0 conversación(es)", tone: "neutral" },
      { label: "Última respuesta del bot", value: "hace 1 h", tone: "neutral" },
    ]);
  });

  it("ámbar fuera de horario", () => {
    const s = botStatus({ ...input({ schedule: MIE_JUE_NOCHE }), channels: encendido });
    expect(s).toMatchObject({ tone: "amber", label: "Bot fuera de horario" });
    expect(s?.lines[1]).toEqual({ label: "Horario", value: "mié–jue 20:00–6:00 (hora de Mazatlán) · ahora fuera de horario", tone: "amber" });
  });

  it("rojo apagado (gana a todo lo demás)", () => {
    const s = botStatus({ ...input({ schedule: MIE_JUE_NOCHE }), channels: [{ displayName: "WhatsApp Diluvium", on: false }] });
    expect(s).toMatchObject({ tone: "red", label: "Bot apagado" });
    expect(s?.lines[0]).toEqual({ label: "Canal", value: "Apagado", tone: "red" });
  });

  it("rojo callado", () => {
    const s = botStatus({ ...input(), channels: encendido });
    expect(s).toMatchObject({ tone: "red", label: "Bot callado" });
    expect(s?.lines[2]).toEqual({ label: "Sin respuesta hace más de 15 min", value: "3 conversación(es)", tone: "red" });
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
      { tone: "amber", text: "El bot solo contesta mié–jue 20:00–6:00 (ahora está fuera de horario)" },
    ]);
    // Miércoles 30-sep 21:00 en Mazatlán.
    expect(botBanner({ channels: encendido, schedule: MIE_JUE_NOCHE, now: new Date("2026-10-01T04:00:00Z") })).toEqual([
      { tone: "neutral", text: "El bot solo contesta mié–jue 20:00–6:00 (ahora sí está contestando)" },
    ]);
  });

  it("canal Apagado: lo dice (y el horario ya no importa)", () => {
    expect(botBanner({ channels: [{ displayName: "WhatsApp Diluvium", on: false }], schedule: MIE_JUE_NOCHE, now: NOW })).toEqual([
      { tone: "red", text: "El bot está apagado en WhatsApp Diluvium" },
    ]);
  });
});
