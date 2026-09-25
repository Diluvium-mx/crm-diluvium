import { describe, expect, it } from "vitest";
import { pauseReason } from "./labels";
import { MAX_PAUSE_MS, PAUSE_ERRORS, pauseUntil, returnLabel } from "./pause";

// Mazatlán es UTC-7 fijo: 15:00 locales del viernes 25-sep-2026 = 22:00Z.
const NOW = new Date("2026-09-25T22:00:00Z");
const HOUR = 3_600_000;

describe("pauseUntil: hora de regreso del bot", () => {
  it("8, 12 y 24 horas desde ahora", () => {
    expect(pauseUntil("8h", NOW)).toEqual({ ok: true, until: new Date(NOW.getTime() + 8 * HOUR) });
    expect(pauseUntil("12h", NOW)).toEqual({ ok: true, until: new Date(NOW.getTime() + 12 * HOUR) });
    expect(pauseUntil("24h", NOW)).toEqual({ ok: true, until: new Date(NOW.getTime() + 24 * HOUR) });
  });

  it("hasta que lo reactive = sin hora (null)", () => {
    expect(pauseUntil("indefinido", NOW)).toEqual({ ok: true, until: null });
  });

  it("hora exacta en hora de Mazatlán (no la del navegador ni UTC)", () => {
    expect(pauseUntil("exacta", NOW, "2026-09-25T22:30")).toEqual({ ok: true, until: new Date("2026-09-26T05:30:00Z") });
    // A 3 minutos (la prueba del celular).
    expect(pauseUntil("exacta", NOW, "2026-09-25T15:03")).toEqual({ ok: true, until: new Date("2026-09-25T22:03:00Z") });
  });

  it("rechaza horas pasadas (incluida la hora actual) con un mensaje claro", () => {
    expect(pauseUntil("exacta", NOW, "2026-09-25T14:59")).toEqual({ ok: false, message: PAUSE_ERRORS.past });
    expect(pauseUntil("exacta", NOW, "2026-09-25T15:00")).toEqual({ ok: false, message: PAUSE_ERRORS.past });
    // Las 15:00 en UTC serían futuras: se interpreta como Mazatlán.
    expect(pauseUntil("exacta", NOW, "2026-09-24T22:30")).toEqual({ ok: false, message: PAUSE_ERRORS.past });
  });

  it("máximo 30 días", () => {
    const limit = new Date(NOW.getTime() + MAX_PAUSE_MS); // 25-oct 15:00 Mazatlán
    expect(pauseUntil("exacta", NOW, "2026-10-25T15:00")).toEqual({ ok: true, until: limit });
    expect(pauseUntil("exacta", NOW, "2026-10-25T15:01")).toEqual({ ok: false, message: PAUSE_ERRORS.tooFar });
  });

  it("fecha inválida o vacía", () => {
    for (const bad of [undefined, null, "", "mañana", "2026-02-30T10:00", "2026-09-25T24:00"]) {
      expect(pauseUntil("exacta", NOW, bad)).toEqual({ ok: false, message: PAUSE_ERRORS.invalid });
    }
  });
});

describe("returnLabel / pauseReason: texto del aviso", () => {
  it("hoy, mañana u otro día (en hora de Mazatlán)", () => {
    expect(returnLabel(new Date("2026-09-26T05:30:00Z"), NOW)).toBe("hoy 22:30");
    expect(returnLabel(new Date("2026-09-26T15:15:00Z"), NOW)).toBe("mañana 08:15");
    expect(returnLabel(new Date("2026-09-27T17:00:00Z"), NOW)).toBe("dom 27-sep 10:00");
    expect(returnLabel(new Date("2026-10-05T17:00:00Z"), NOW)).toBe("lun 5-oct 10:00");
  });

  it("el día cambia a la medianoche de Mazatlán, no a la de UTC", () => {
    // 23:30 del viernes en Mazatlán (06:30Z del sábado): 01:00 del sábado es "mañana".
    const lateNight = new Date("2026-09-26T06:30:00Z");
    expect(returnLabel(new Date("2026-09-26T08:00:00Z"), lateNight)).toBe("mañana 01:00");
    expect(returnLabel(new Date("2026-09-26T06:45:00Z"), lateNight)).toBe("hoy 23:45");
  });

  it("pauseReason: con hora dice cuándo vuelve; sin hora, hasta que lo reactiven", () => {
    expect(pauseReason({ agentState: "activo", pausedUntil: null }, NOW)).toBe("");
    expect(pauseReason({ agentState: "pausado_humano", pausedUntil: "2026-09-26T05:30:00.000Z" }, NOW)).toBe("vuelve hoy 22:30");
    expect(pauseReason({ agentState: "pausado_humano", pausedUntil: null }, NOW)).toBe("hasta que lo reactives");
    expect(pauseReason({ agentState: "pausado_antibucle", pausedUntil: null }, NOW)).toBe("en pausa");
  });
});
