import { describe, expect, it } from "vitest";
import { hasCardFilter, isDestacado, isTemperatureFilter, matchesCardFilter, matchesTemperature } from "./filters";

describe("filtro por temperatura", () => {
  it("sin filtro pasa todo, incluso sin temperatura", () => {
    expect(matchesTemperature(null, null)).toBe(true);
    expect(matchesTemperature("caliente", null)).toBe(true);
    expect(matchesTemperature("destacado", null)).toBe(true);
  });

  it("una temperatura a la vez, exacta", () => {
    expect(matchesTemperature("caliente", "caliente")).toBe(true);
    expect(matchesTemperature("frio", "caliente")).toBe(false);
    expect(matchesTemperature("destacado", "caliente")).toBe(false);
    expect(matchesTemperature(null, "caliente")).toBe(false);
  });

  it("«sin asignar» = sin temperatura (la ⭐ cuenta como asignada)", () => {
    expect(matchesTemperature(null, "none")).toBe(true);
    expect(matchesTemperature(undefined, "none")).toBe(true);
    expect(matchesTemperature("destacado", "none")).toBe(false);
  });

  it("solo acepta los valores del filtro (la ⭐ no es una temperatura del filtro)", () => {
    expect(isTemperatureFilter("caliente")).toBe(true);
    expect(isTemperatureFilter("none")).toBe(true);
    expect(isTemperatureFilter("destacado")).toBe(false);
    expect(isTemperatureFilter("")).toBe(false);
    expect(isTemperatureFilter(undefined)).toBe(false);
  });
});

describe("Destacado", () => {
  it("es la estrella del chat o la temperatura ⭐", () => {
    expect(isDestacado("destacado", false)).toBe(true);
    expect(isDestacado("caliente", true)).toBe(true);
    expect(isDestacado(null, true)).toBe(true);
    expect(isDestacado("caliente", false)).toBe(false);
    expect(isDestacado(null, undefined)).toBe(false);
  });
});

describe("filtro de la tarjeta del Embudo", () => {
  const hot = { temperature: "caliente" };
  const star = { temperature: "destacado" };
  const none = { temperature: null };

  it("sin nada elegido no filtra", () => {
    expect(hasCardFilter({ temperature: null, destacado: false })).toBe(false);
    expect(matchesCardFilter(none, undefined, { temperature: null, destacado: false })).toBe(true);
  });

  it("Destacado solo: ⭐ o estrella, sin importar la temperatura", () => {
    const f = { temperature: null, destacado: true };
    expect(hasCardFilter(f)).toBe(true);
    expect(matchesCardFilter(star, false, f)).toBe(true);
    expect(matchesCardFilter(hot, true, f)).toBe(true);
    expect(matchesCardFilter(hot, false, f)).toBe(false);
    expect(matchesCardFilter(none, undefined, f)).toBe(false);
  });

  it("la única mezcla: una temperatura + Destacado (calientes con estrella)", () => {
    const f = { temperature: "caliente" as const, destacado: true };
    expect(matchesCardFilter(hot, true, f)).toBe(true);
    expect(matchesCardFilter(hot, false, f)).toBe(false);
    // Temperatura ⭐ no es 🔥: no entra aunque sea Destacado.
    expect(matchesCardFilter(star, false, f)).toBe(false);
  });

  it("«sin asignar» + Destacado = sin temperatura pero con estrella", () => {
    const f = { temperature: "none" as const, destacado: true };
    expect(matchesCardFilter(none, true, f)).toBe(true);
    expect(matchesCardFilter(none, false, f)).toBe(false);
    expect(matchesCardFilter(star, true, f)).toBe(false);
  });
});
