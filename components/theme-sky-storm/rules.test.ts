import { describe, expect, it } from "vitest";
import { canPlace, canTurn, freshState, leakRate, RULES, sealed, type StormState } from "./rules";

const state = (over: Partial<StormState> = {}): StormState => ({ ...freshState(), ...over });
const ready = (over: Partial<StormState> = {}) => state({ putty: [3, 3], strip: 2, inside: true, ...over });

describe("leakRate", () => {
  it("no entra agua mientras el agua no pasa el piso de la entrada", () => {
    expect(leakRate(state(), 0)).toBe(0);
    expect(leakRate(state({ inside: true }), -0.05)).toBe(0);
  });

  it("con la puerta cerrada entra mucho menos que con la puerta abierta sin compuerta", () => {
    expect(leakRate(state(), 0.1)).toBeLessThan(leakRate(state({ inside: true }), 0.1));
  });

  it("con la compuerta puesta siempre entra menos que sin ella, aunque todo esté suelto", () => {
    for (const excess of [0.01, 0.1, 0.4]) {
      expect(leakRate(ready({ gate: true }), excess)).toBeLessThan(leakRate(ready(), excess));
    }
  });

  it("apretar el gato y los tornillos baja la fuga hasta cero", () => {
    const loose = leakRate(ready({ gate: true }), 0.2);
    const jack = leakRate(ready({ gate: true, jack: RULES.jackClicks }), 0.2);
    const all = leakRate(ready({ gate: true, jack: RULES.jackClicks, bolts: [3, 3, 3] }), 0.2);
    expect(jack).toBeLessThan(loose);
    expect(all).toBe(0);
  });

  it("sube con el nivel del agua", () => {
    expect(leakRate(state({ inside: true }), 0.3)).toBeGreaterThan(leakRate(state({ inside: true }), 0.1));
  });
});

describe("canPlace", () => {
  it("la Plastiloka va solo al inicio, antes de la tira", () => {
    expect(canPlace(state(), "putty")).toBe(true);
    expect(canPlace(state({ putty: [3, 3] }), "putty")).toBe(false);
    expect(canPlace(state({ strip: 1 }), "putty")).toBe(false);
  });

  it("la tira se pone después de la Plastiloka y una sola vez", () => {
    expect(canPlace(state(), "roll")).toBe(false);
    expect(canPlace(state({ putty: [3, 2] }), "roll")).toBe(false);
    expect(canPlace(state({ putty: [3, 3] }), "roll")).toBe(true);
    expect(canPlace(state({ putty: [3, 3], strip: 2 }), "roll")).toBe(false);
  });

  it("la compuerta va adentro, con la tira completa y una sola vez", () => {
    expect(canPlace(state({ putty: [3, 3], strip: 2 }), "gate")).toBe(false);
    expect(canPlace(ready({ strip: 1 }), "gate")).toBe(false);
    expect(canPlace(ready(), "gate")).toBe(true);
    expect(canPlace(ready({ gate: true }), "gate")).toBe(false);
  });
});

describe("canTurn y sealed", () => {
  it("primero el gato y después cada tornillo hasta sus clics", () => {
    const st = ready({ gate: true });
    expect(canTurn(st, { type: "jack", i: 0 })).toBe(true);
    expect(canTurn(st, { type: "bolt", i: 0 })).toBe(false);
    const jackOk = ready({ gate: true, jack: RULES.jackClicks, bolts: [3, 0, 0] });
    expect(canTurn(jackOk, { type: "jack", i: 0 })).toBe(false);
    expect(canTurn(jackOk, { type: "bolt", i: 0 })).toBe(false);
    expect(canTurn(jackOk, { type: "bolt", i: 1 })).toBe(true);
  });

  it("solo queda sellado con todo puesto y apretado", () => {
    expect(sealed(ready({ gate: true, jack: RULES.jackClicks, bolts: [3, 3, 2] }))).toBe(false);
    expect(sealed(ready({ gate: true, jack: RULES.jackClicks, bolts: [3, 3, 3] }))).toBe(true);
  });
});
