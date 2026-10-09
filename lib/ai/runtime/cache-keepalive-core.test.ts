import { describe, expect, it } from "vitest";
import { effectiveTouch, keepAliveDue } from "./cache-keepalive-core";

// Mazatlán = UTC−7 todo el año (sin horario de verano).
const mzt = (local: string) => new Date(`${local}:00-07:00`);
const minutesBefore = (d: Date, min: number) => new Date(d.getTime() - min * 60_000);

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

  it("las 24 horas (9-oct-2026): también de noche y antes de las 7:00", () => {
    for (const at of ["2026-10-02T22:30", "2026-10-03T02:00", "2026-10-03T06:55"]) {
      const t = mzt(at);
      expect(keepAliveDue(t, minutesBefore(t, 52))).toBe(true);
    }
  });
});

describe("renovación que reescribió la caché (9-oct-2026)", () => {
  const good = mzt("2026-10-08T12:20");
  const cold = mzt("2026-10-08T13:11");

  it("la primera que la reescribe cuenta: se sigue renovando 50 min después de ella", () => {
    expect(effectiveTouch(good, 1, cold)).toEqual(cold);
    expect(keepAliveDue(minutesBefore(cold, -52), effectiveTouch(good, 1, cold))).toBe(true);
  });

  it("si dos seguidas la reescriben, se deja de renovar hasta la siguiente respuesta real", () => {
    expect(effectiveTouch(good, 2, mzt("2026-10-08T14:03"))).toEqual(good);
  });

  it("sin reescrituras manda la última respuesta o renovación que la tocó", () => {
    expect(effectiveTouch(good, 0, null)).toEqual(good);
    expect(effectiveTouch(null, 0, null)).toBeNull();
  });
});
