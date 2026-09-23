import { describe, expect, it } from "vitest";
import { instantToLocal, localToInstant, textAllowedAt, validateSendAt } from "./rules";

describe("localToInstant / instantToLocal (America/Mazatlan, UTC-7)", () => {
  it("convierte la hora local a UTC y de regreso", () => {
    const instant = localToInstant("2026-09-23T10:00");
    expect(instant?.toISOString()).toBe("2026-09-23T17:00:00.000Z");
    expect(instantToLocal(instant!)).toBe("2026-09-23T10:00");
  });

  it("cruza la medianoche UTC correctamente", () => {
    expect(localToInstant("2026-09-23T20:30")?.toISOString()).toBe("2026-09-24T03:30:00.000Z");
    expect(instantToLocal(new Date("2026-09-24T03:30:00Z"))).toBe("2026-09-23T20:30");
  });

  it("rechaza formatos y fechas imposibles", () => {
    expect(localToInstant("2026-02-30T10:00")).toBeNull();
    expect(localToInstant("2026-09-23 10:00")).toBeNull();
    expect(localToInstant("2026-09-23T24:00")).toBeNull();
    expect(localToInstant("")).toBeNull();
  });
});

describe("validateSendAt", () => {
  const now = new Date("2026-09-22T18:00:00Z");
  it("exige al menos 1 minuto adelante y a lo más 60 días", () => {
    expect(validateSendAt(new Date("2026-09-22T18:00:30Z"), now)).toBe("too_soon");
    expect(validateSendAt(new Date("2026-09-22T17:00:00Z"), now)).toBe("too_soon");
    expect(validateSendAt(new Date("2026-09-22T18:01:00Z"), now)).toBeNull();
    expect(validateSendAt(new Date("2026-11-21T18:00:00Z"), now)).toBeNull();
    expect(validateSendAt(new Date("2026-11-21T18:00:01Z"), now)).toBe("too_far");
    expect(validateSendAt(null, now)).toBe("invalid");
  });
});

describe("textAllowedAt", () => {
  const expires = new Date("2026-09-23T12:00:00Z");
  it("texto libre solo si la ventana sigue abierta a la hora de envío", () => {
    expect(textAllowedAt(expires, new Date("2026-09-23T11:59:00Z"))).toBe(true);
    expect(textAllowedAt(expires, new Date("2026-09-23T12:00:00Z"))).toBe(false);
    expect(textAllowedAt(null, new Date("2026-09-23T11:00:00Z"))).toBe(false);
  });
});
