import { describe, expect, it } from "vitest";
import { hasCardFilter, isTemperatureFilter, matchesCardFilter, matchesTemperature } from "./filters";

describe("filtro por temperatura", () => {
  it("sin filtro pasa todo, incluso sin temperatura", () => {
    expect(matchesTemperature(null, null)).toBe(true);
    expect(matchesTemperature("caliente", null)).toBe(true);
  });

  it("una temperatura a la vez, exacta", () => {
    expect(matchesTemperature("caliente", "caliente")).toBe(true);
    expect(matchesTemperature("frio", "caliente")).toBe(false);
    expect(matchesTemperature(null, "caliente")).toBe(false);
  });

  it("«sin asignar» = sin temperatura", () => {
    expect(matchesTemperature(null, "none")).toBe(true);
    expect(matchesTemperature(undefined, "none")).toBe(true);
    expect(matchesTemperature("en_espera", "none")).toBe(false);
  });

  it("solo acepta los valores del filtro (⭐ no es temperatura)", () => {
    expect(isTemperatureFilter("caliente")).toBe(true);
    expect(isTemperatureFilter("none")).toBe(true);
    expect(isTemperatureFilter("destacado")).toBe(false);
    expect(isTemperatureFilter("")).toBe(false);
    expect(isTemperatureFilter(undefined)).toBe(false);
  });
});

describe("filtro de la tarjeta del Embudo", () => {
  const hotStar = { temperature: "caliente", destacado: true };
  const hot = { temperature: "caliente", destacado: false };
  const star = { temperature: null, destacado: true };
  const none = { temperature: null, destacado: false };

  it("sin nada elegido no filtra", () => {
    expect(hasCardFilter({ temperature: null, destacado: false })).toBe(false);
    expect(matchesCardFilter(none, { temperature: null, destacado: false })).toBe(true);
  });

  it("Destacado solo: la marca, sin importar la temperatura", () => {
    const f = { temperature: null, destacado: true };
    expect(hasCardFilter(f)).toBe(true);
    expect(matchesCardFilter(star, f)).toBe(true);
    expect(matchesCardFilter(hotStar, f)).toBe(true);
    expect(matchesCardFilter(hot, f)).toBe(false);
  });

  it("una temperatura + Destacado (calientes y destacados)", () => {
    const f = { temperature: "caliente" as const, destacado: true };
    expect(matchesCardFilter(hotStar, f)).toBe(true);
    expect(matchesCardFilter(hot, f)).toBe(false);
    expect(matchesCardFilter(star, f)).toBe(false);
  });

  it("«sin asignar» + Destacado = destacados sin temperatura", () => {
    const f = { temperature: "none" as const, destacado: true };
    expect(matchesCardFilter(star, f)).toBe(true);
    expect(matchesCardFilter(none, f)).toBe(false);
    expect(matchesCardFilter(hotStar, f)).toBe(false);
  });
});
