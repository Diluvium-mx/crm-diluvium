import { describe, expect, it } from "vitest";
import {
  formatRangeLabel,
  matchingPreset,
  nextRange,
  presetRange,
  rangeQuery,
  visibleMonths,
} from "./range-picker";

const HOY = "2026-11-21";

describe("formatRangeLabel", () => {
  it("un día, mismo año y años distintos", () => {
    expect(formatRangeLabel(HOY, HOY)).toBe("21 nov 2026");
    expect(formatRangeLabel("2026-11-12", "2026-11-30")).toBe("12 nov – 30 nov 2026");
    expect(formatRangeLabel("2026-12-28", "2027-01-03")).toBe("28 dic 2026 – 3 ene 2027");
    expect(formatRangeLabel("", "")).toBe("Elegir periodo");
  });
});

describe("presetRange / matchingPreset", () => {
  it("cada atajo según hoy", () => {
    expect(presetRange("hoy", HOY)).toEqual({ desde: HOY, hasta: HOY });
    expect(presetRange("ayer", HOY)).toEqual({ desde: "2026-11-20", hasta: "2026-11-20" });
    expect(presetRange("7", HOY)).toEqual({ desde: "2026-11-15", hasta: HOY });
    expect(presetRange("30", HOY)).toEqual({ desde: "2026-10-23", hasta: HOY });
    expect(presetRange("mes", HOY)).toEqual({ desde: "2026-11-01", hasta: HOY });
    expect(presetRange("mesPasado", HOY)).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
  });
  it("mes pasado en enero es diciembre del año anterior", () => {
    expect(presetRange("mesPasado", "2027-01-05")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
  it("reconoce el atajo de un rango", () => {
    expect(matchingPreset("2026-11-15", HOY, HOY)).toBe("7");
    expect(matchingPreset("2026-11-12", "2026-11-30", HOY)).toBeNull();
  });
});

describe("nextRange", () => {
  it("primer clic = inicio (y fin), segundo clic = fin", () => {
    const uno = nextRange({ desde: "2026-11-01", hasta: "2026-11-30", esperandoFin: false }, "2026-11-12");
    expect(uno).toEqual({ desde: "2026-11-12", hasta: "2026-11-12", esperandoFin: true });
    expect(nextRange(uno, "2026-11-20")).toEqual({ desde: "2026-11-12", hasta: "2026-11-20", esperandoFin: false });
  });
  it("si el segundo clic es antes, se voltean", () => {
    const uno = nextRange({ desde: HOY, hasta: HOY, esperandoFin: false }, "2026-11-12");
    expect(nextRange(uno, "2026-11-03")).toEqual({ desde: "2026-11-03", hasta: "2026-11-12", esperandoFin: false });
  });
});

describe("rangeQuery", () => {
  it("un mes completo, o este mes hasta hoy, va como mes", () => {
    expect(rangeQuery("2026-10-01", "2026-10-31", HOY)).toEqual({ mes: "2026-10" });
    expect(rangeQuery("2026-11-01", HOY, HOY)).toEqual({ mes: "2026-11" });
    expect(rangeQuery("2026-11-01", "2026-11-30", HOY)).toEqual({ mes: "2026-11" });
  });
  it("cualquier otro rango va como desde y hasta", () => {
    expect(rangeQuery("2026-11-12", "2026-11-30", HOY)).toEqual({ desde: "2026-11-12", hasta: "2026-11-30" });
    expect(rangeQuery("2026-10-01", "2026-10-30", HOY)).toEqual({ desde: "2026-10-01", hasta: "2026-10-30" });
    expect(rangeQuery("2026-10-15", "2026-11-14", HOY)).toEqual({ desde: "2026-10-15", hasta: "2026-11-14" });
  });
});

describe("visibleMonths", () => {
  it("el mes del fin a la derecha y el anterior a la izquierda", () => {
    expect(visibleMonths("2026-11-30")).toEqual({ left: { y: 2026, m: 10 }, right: { y: 2026, m: 11 } });
    expect(visibleMonths("2027-01-03")).toEqual({ left: { y: 2026, m: 12 }, right: { y: 2027, m: 1 } });
  });
});
