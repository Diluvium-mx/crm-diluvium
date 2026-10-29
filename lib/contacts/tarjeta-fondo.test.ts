import { describe, expect, it } from "vitest";
import { tarjetaFondo } from "./tarjeta-fondo";

const PROPIO = "d3bc6189-89c8-4739-b29d-06d9b4b909c6";
const PAQUETERIA = "74f1580f-eddf-4833-ba12-7493c5323170";
const COSTURA = "e5aeb75f-9c5c-4673-ae43-1ba54aec9227";

describe("fondo de la tarjeta del Embudo (29-oct-2026)", () => {
  it("cada chat que no es cliente lleva su fondo fijo", () => {
    expect(tarjetaFondo(PROPIO, undefined)).toBe("propio");
    expect(tarjetaFondo(PAQUETERIA, undefined)).toBe("paqueteria");
    expect(tarjetaFondo(COSTURA, undefined)).toBe("costura");
  });

  it("un cliente cualquiera no lleva fondo (ni con un id que parece llave de objeto)", () => {
    expect(tarjetaFondo("contact_cualquiera", undefined)).toBeUndefined();
    expect(tarjetaFondo("constructor", undefined)).toBeUndefined();
  });

  it("si la tarjeta pide atención (azul o amarilla), manda ese color y el patrón no sale", () => {
    expect(tarjetaFondo(PAQUETERIA, "pending")).toBeUndefined();
    expect(tarjetaFondo(PROPIO, "urgent")).toBeUndefined();
  });
});
