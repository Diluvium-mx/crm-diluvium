import { describe, expect, it } from "vitest";
import { tarjetaFondo } from "./tarjeta-fondo";

const PROPIO = "d3bc6189-89c8-4739-b29d-06d9b4b909c6";
const PAQUETERIA = "74f1580f-eddf-4833-ba12-7493c5323170";
const COSTURA = "e5aeb75f-9c5c-4673-ae43-1ba54aec9227";
const FOTO = "d87bc548-54bd-4236-a0ec-854791cc7702";

describe("fondo de la tarjeta del Embudo", () => {
  it("cada chat que no es cliente lleva su fondo fijo", () => {
    expect(tarjetaFondo(PROPIO)).toBe("propio");
    expect(tarjetaFondo(PAQUETERIA)).toBe("paqueteria");
    expect(tarjetaFondo(COSTURA)).toBe("costura");
    expect(tarjetaFondo(FOTO)).toBe("foto");
  });

  it("un cliente cualquiera no lleva fondo (ni con un id que parece llave de objeto)", () => {
    expect(tarjetaFondo("contact_cualquiera")).toBeUndefined();
    expect(tarjetaFondo("constructor")).toBeUndefined();
  });
});
