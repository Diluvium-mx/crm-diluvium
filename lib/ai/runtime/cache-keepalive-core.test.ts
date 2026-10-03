import { describe, expect, it } from "vitest";
import { keepAliveDue, withinKeepAliveHours } from "./cache-keepalive-core";

// Mazatlán = UTC−7 todo el año (sin horario de verano).
const mzt = (local: string) => new Date(`${local}:00-07:00`);
const minutesBefore = (d: Date, min: number) => new Date(d.getTime() - min * 60_000);

describe("horario de renovación de la caché (7:00–22:00 Mazatlán)", () => {
  it("incluye las 7:00 y excluye las 22:00", () => {
    expect(withinKeepAliveHours(mzt("2026-10-02T06:59"))).toBe(false);
    expect(withinKeepAliveHours(mzt("2026-10-02T07:00"))).toBe(true);
    expect(withinKeepAliveHours(mzt("2026-10-02T21:59"))).toBe(true);
    expect(withinKeepAliveHours(mzt("2026-10-02T22:00"))).toBe(false);
    expect(withinKeepAliveHours(mzt("2026-10-03T02:00"))).toBe(false);
  });
});

describe("¿toca renovar?", () => {
  const now = mzt("2026-10-02T12:00");

  it("solo entre los 50 y los 58 min desde la última llamada que tocó la caché", () => {
    expect(keepAliveDue(now, minutesBefore(now, 49))).toBe(false);
    expect(keepAliveDue(now, minutesBefore(now, 50))).toBe(true);
    expect(keepAliveDue(now, minutesBefore(now, 57))).toBe(true);
    // Ya casi vencida o vencida: no se escribe una caché nueva por adelantado.
    expect(keepAliveDue(now, minutesBefore(now, 58))).toBe(false);
    expect(keepAliveDue(now, minutesBefore(now, 90))).toBe(false);
  });

  it("sin llamada reciente no hay nada que mantener", () => {
    expect(keepAliveDue(now, null)).toBe(false);
  });

  it("fuera de horario no renueva aunque la caché siga viva", () => {
    const night = mzt("2026-10-02T22:30");
    expect(keepAliveDue(night, minutesBefore(night, 52))).toBe(false);
    const early = mzt("2026-10-02T06:55");
    expect(keepAliveDue(early, minutesBefore(early, 52))).toBe(false);
  });
});
