import { describe, expect, it } from "vitest";
import { direccionMirada } from "./robot-mirada";

describe("direccionMirada", () => {
  it("con el cursor en el centro mira al frente", () => {
    expect(direccionMirada(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("lejos mira con todo hacia el cursor, sin pasarse de 1", () => {
    const derecha = direccionMirada(600, 0);
    expect(derecha.x).toBeCloseTo(1);
    expect(derecha.y).toBeCloseTo(0);
    const abajoIzquierda = direccionMirada(-300, 300);
    expect(Math.hypot(abajoIzquierda.x, abajoIzquierda.y)).toBeCloseTo(1);
    expect(abajoIzquierda.x).toBeLessThan(0);
    expect(abajoIzquierda.y).toBeGreaterThan(0);
  });

  it("cerca del robot mira menos (no bizquea con el cursor encima)", () => {
    const cerca = direccionMirada(12, 0);
    expect(cerca.x).toBeCloseTo(0.1);
    expect(direccionMirada(60, 0).x).toBeCloseTo(0.5);
  });
});
