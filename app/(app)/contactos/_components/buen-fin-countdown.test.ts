import { describe, expect, it } from "vitest";
import { textoFaltan } from "./buen-fin-countdown";

const s = (iso: string) => Date.parse(iso) / 1000;

describe("textoFaltan (temporizador de la columna Buen Fin)", () => {
  it("cuenta hasta el martes 17 de noviembre de 2026 a las 23:59:59 de Mazatlán", () => {
    // 3-nov 12:00 Mazatlán → faltan 14 días, 11:59:59.
    expect(textoFaltan(s("2026-11-03T12:00:00-07:00"))).toBe("14d 11:59:59");
    // El primer día del Buen Fin a medianoche de Mazatlán.
    expect(textoFaltan(s("2026-11-13T00:00:00-07:00"))).toBe("4d 23:59:59");
  });

  it("el último segundo y lo que sigue dicen «Terminó»", () => {
    expect(textoFaltan(s("2026-11-17T23:59:58-07:00"))).toBe("0d 00:00:01");
    expect(textoFaltan(s("2026-11-17T23:59:59-07:00"))).toBe("Terminó");
    expect(textoFaltan(s("2026-11-20T10:00:00-07:00"))).toBe("Terminó");
  });
});
