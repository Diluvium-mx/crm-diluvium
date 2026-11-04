import { describe, expect, it } from "vitest";
import { metaCostoUsd } from "./meta-estimado";

describe("metaCostoUsd", () => {
  it("con los mensajes que cobró Meta en octubre da su factura (US$44.16 sin IVA, 1-nov-2026)", () => {
    // WhatsApp Manager › Precios de mensajes, oct 1–31: 345 de marketing, 69 de utilidad y 2,571 normales.
    const usd = metaCostoUsd({ marketing: 345, utilidad: 69, servicio: 2571 });
    expect(usd).toBeCloseTo(44.19, 2);
    expect(Math.abs(usd / 44.16 - 1)).toBeLessThan(0.005);
  });
});
