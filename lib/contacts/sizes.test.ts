import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIZE_RANGES,
  suggestSize,
  validateSizeRanges,
  type SizeRange,
} from "./sizes";

describe("suggestSize", () => {
  it.each([
    [62, "mini", "XXCH"],
    [70, "mini", "XXCH"],
    [71, "mini", "XCH"],
    [61, "mini", null],
    [90, "mini", "M"],
    [90, "estandar", "Estándar"],
    [121, "mini", "XXG"],
    [121, "estandar", "A la medida"],
    [124, "mini", null],
    [251, "estandar", null],
    [null, "mini", null],
  ] as const)("para %s cm en %s devuelve %s", (anchoCm, linea, expected) => {
    expect(suggestSize(anchoCm, linea, DEFAULT_SIZE_RANGES)).toBe(expected);
  });

  it("elige el rango de menor posición si hay más de una coincidencia", () => {
    const ranges: SizeRange[] = [
      { linea: "mini", talla: "Segunda", minCm: 80, maxCm: 100, posicion: 2 },
      { linea: "mini", talla: "Primera", minCm: 90, maxCm: 110, posicion: 1 },
    ];
    expect(suggestSize(95, "mini", ranges)).toBe("Primera");
  });
});

describe("validateSizeRanges", () => {
  it("detecta rangos encimados dentro de la misma línea", () => {
    const ranges: SizeRange[] = [
      { linea: "mini", talla: "A", minCm: 60, maxCm: 80, posicion: 1 },
      { linea: "mini", talla: "B", minCm: 80, maxCm: 90, posicion: 2 },
    ];
    expect(validateSizeRanges(ranges)).toEqual([
      'Las tallas "A" y "B" se enciman en la línea mini.',
    ]);
  });

  it("acepta rangos encimados entre líneas distintas", () => {
    const ranges: SizeRange[] = [
      { linea: "mini", talla: "M", minCm: 89, maxCm: 97, posicion: 1 },
      { linea: "estandar", talla: "Estándar", minCm: 69, maxCm: 120, posicion: 1 },
    ];
    expect(validateSizeRanges(ranges)).toEqual([]);
  });

  it("detecta talla vacía o duplicada y límites inválidos", () => {
    const ranges: SizeRange[] = [
      { linea: "mini", talla: " ", minCm: 0, maxCm: 10, posicion: 1 },
      { linea: "mini", talla: "M", minCm: 20, maxCm: 10, posicion: 2 },
      { linea: "mini", talla: "m", minCm: 30, maxCm: 40, posicion: 3 },
    ];
    const errors = validateSizeRanges(ranges);
    expect(errors.some((error) => error.includes("vacía"))).toBe(true);
    expect(errors.some((error) => error.includes("duplicada"))).toBe(true);
    expect(errors.some((error) => error.includes("mayor que 0"))).toBe(true);
    expect(errors.some((error) => error.includes("mínimo mayor"))).toBe(true);
  });
});
