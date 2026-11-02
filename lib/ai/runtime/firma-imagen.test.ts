import { describe, expect, it } from "vitest";
import { FIRMA_IMAGEN_HORA_MS, FIRMA_IMAGEN_VIGENCIA_S, horaDeFirma } from "./firma-imagen";

describe("firma estable de las fotos que ve el Agente IA", () => {
  it("toda la hora firma con la misma hora redonda", () => {
    const a = horaDeFirma(new Date("2026-11-02T18:00:00.000Z"));
    const b = horaDeFirma(new Date("2026-11-02T18:59:59.999Z"));
    expect(a.toISOString()).toBe("2026-11-02T18:00:00.000Z");
    expect(b.getTime()).toBe(a.getTime());
    expect(horaDeFirma(new Date("2026-11-02T19:00:00.000Z")).toISOString()).toBe("2026-11-02T19:00:00.000Z");
  });

  it("la URL sigue valiendo al menos 1 h desde que se pide", () => {
    expect(FIRMA_IMAGEN_VIGENCIA_S * 1000 - FIRMA_IMAGEN_HORA_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });
});
