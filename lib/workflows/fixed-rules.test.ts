import { describe, expect, it } from "vitest";
import { fixedRuleWinner, PRECIO_Y_MEDIDAS } from "./fixed-rules";

describe("regla fija «precio y medidas» (29-sep-2026, decisión del dueño)", () => {
  const yes = () => true;
  it("con «Precio 2» y la Tabla en el mismo mensaje, gana «Información»", () => {
    expect(fixedRuleWinner(new Set([PRECIO_Y_MEDIDAS.precio, PRECIO_Y_MEDIDAS.tabla]), yes)).toBe(PRECIO_Y_MEDIDAS.gana);
    expect(PRECIO_Y_MEDIDAS).toEqual({ precio: "precio_2_6100", tabla: "tabla_tamanos_estandar", gana: "informacion_8b3c" });
  });
  it("con uno solo, o si «Información» no puede salir, no aplica", () => {
    expect(fixedRuleWinner(new Set([PRECIO_Y_MEDIDAS.precio]), yes)).toBeNull();
    expect(fixedRuleWinner(new Set([PRECIO_Y_MEDIDAS.tabla, "tapones_inflables"]), yes)).toBeNull();
    expect(fixedRuleWinner(new Set([PRECIO_Y_MEDIDAS.precio, PRECIO_Y_MEDIDAS.tabla]), () => false)).toBeNull();
  });
});
