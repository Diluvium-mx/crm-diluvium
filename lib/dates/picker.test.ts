// Cuentas del calendario propio del CRM (lib/dates/picker.ts). Sin navegador.
import { describe, expect, it } from "vitest";
import { addMonths, clampValue, dayOutOfRange, displayValue, formatValue, from12h, minuteOptions, monthMatrix, parseValue, to12h } from "./picker";

describe("valores en el formato del input nativo", () => {
  it("fecha y hora, fecha sola y hora sola: ida y vuelta", () => {
    for (const [v, mode] of [
      ["2026-10-08T17:05", "datetime"],
      ["2026-10-08", "date"],
      ["07:30", "time"],
    ] as const) {
      expect(formatValue(parseValue(v, mode)!, mode)).toBe(v);
    }
    expect(parseValue("", "date")).toBeNull();
    expect(parseValue("2026-02-30", "date")).toBeNull();
    expect(parseValue("2026-10-08", "datetime")).toBeNull();
  });

  it("se lee como el nativo de Chrome en español: 08/10/2026, 05:00 p.m.", () => {
    expect(displayValue("2026-10-08T17:00", "datetime")).toBe("08/10/2026, 05:00 p.m.");
    expect(displayValue("2026-10-08", "date")).toBe("08/10/2026");
    expect(displayValue("00:15", "time")).toBe("12:15 a.m.");
    expect(displayValue("12:00", "time")).toBe("12:00 p.m.");
    expect(displayValue("", "time")).toBe("");
  });

  it("12 h ↔ 24 h", () => {
    expect(to12h(0)).toEqual({ h12: 12, ap: "a.m." });
    expect(to12h(13)).toEqual({ h12: 1, ap: "p.m." });
    expect(from12h(12, "a.m.")).toBe(0);
    expect(from12h(12, "p.m.")).toBe(12);
    expect(from12h(5, "p.m.")).toBe(17);
  });
});

describe("el mes en pantalla", () => {
  it("6 semanas, lunes primero: octubre de 2026 empieza en jueves (28, 29 y 30 de septiembre antes)", () => {
    const m = monthMatrix(2026, 10);
    expect(m).toHaveLength(42);
    expect(m.slice(0, 4).map((d) => [d.d, d.inMonth])).toEqual([
      [28, false],
      [29, false],
      [30, false],
      [1, true],
    ]);
    expect(m.filter((d) => d.inMonth)).toHaveLength(31);
  });

  it("flechas: diciembre → enero del año siguiente y al revés", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
    expect(addMonths(2026, 10, -12)).toEqual({ y: 2025, m: 10 });
  });
});

describe("límites y minutos", () => {
  it("días fuera de [mín, máx] se apagan; el valor se lleva dentro del rango", () => {
    expect(dayOutOfRange("2026-10-05", "2026-10-07T10:00", undefined)).toBe(true);
    expect(dayOutOfRange("2026-10-07", "2026-10-07T10:00", "2026-11-06T10:00")).toBe(false);
    expect(dayOutOfRange("2026-11-07", undefined, "2026-11-06T10:00")).toBe(true);
    expect(clampValue("2026-10-07T08:00", "2026-10-07T10:00", undefined)).toBe("2026-10-07T10:00");
    expect(clampValue("2026-10-07T12:00", "2026-10-07T10:00", "2026-10-07T11:00")).toBe("2026-10-07T11:00");
  });

  it("minutos de 5 en 5 (y el actual aunque no caiga en el paso)", () => {
    expect(minuteOptions(5)).toHaveLength(12);
    expect(minuteOptions(5, 7)).toContain(7);
    expect(minuteOptions(1)).toHaveLength(60);
  });
});
