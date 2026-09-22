import { describe, expect, it } from "vitest";
import { localToday, resolveRange } from "./range";

// 2026-09-01 03:00 UTC = 2026-08-31 20:00 en Mazatlán (UTC-7).
const EARLY_UTC = new Date("2026-09-01T03:00:00Z");
const MID_SEPT = new Date("2026-09-22T18:00:00Z");

describe("localToday", () => {
  it("usa el día de Mazatlán, no el de UTC", () => {
    expect(localToday(EARLY_UTC)).toBe("2026-08-31");
    expect(localToday(MID_SEPT)).toBe("2026-09-22");
  });
});

describe("resolveRange", () => {
  it("sin parámetros cae al mes en curso (local)", () => {
    expect(resolveRange({}, MID_SEPT)).toEqual({ desde: "2026-09-01", hasta: "2026-09-30", mes: "2026-09" });
    expect(resolveRange({}, EARLY_UTC)).toEqual({ desde: "2026-08-01", hasta: "2026-08-31", mes: "2026-08" });
  });

  it("mes explícito, incluido febrero bisiesto", () => {
    expect(resolveRange({ mes: "2028-02" }, MID_SEPT)).toEqual({ desde: "2028-02-01", hasta: "2028-02-29", mes: "2028-02" });
  });

  it("desde/hasta válidos mandan sobre el mes", () => {
    expect(resolveRange({ mes: "2026-08", desde: "2026-09-10", hasta: "2026-09-12" }, MID_SEPT)).toEqual({
      desde: "2026-09-10",
      hasta: "2026-09-12",
      mes: null,
    });
  });

  it("un solo día es un rango válido", () => {
    expect(resolveRange({ desde: "2026-09-22", hasta: "2026-09-22" }, MID_SEPT).mes).toBeNull();
  });

  it("ignora rangos invertidos, fechas imposibles, formatos raros y rangos de más de un año", () => {
    const fallback = { desde: "2026-09-01", hasta: "2026-09-30", mes: "2026-09" };
    expect(resolveRange({ desde: "2026-09-12", hasta: "2026-09-10" }, MID_SEPT)).toEqual(fallback);
    expect(resolveRange({ desde: "2026-02-30", hasta: "2026-03-02" }, MID_SEPT)).toEqual(fallback);
    expect(resolveRange({ desde: "2026-9-1", hasta: "2026-09-02" }, MID_SEPT)).toEqual(fallback);
    expect(resolveRange({ desde: "2025-01-01", hasta: "2026-09-01" }, MID_SEPT)).toEqual(fallback);
    expect(resolveRange({ mes: "2026-13" }, MID_SEPT)).toEqual(fallback);
    expect(resolveRange({ mes: "'; drop table contacts;--" }, MID_SEPT)).toEqual(fallback);
  });
});
