import { describe, expect, it } from "vitest";
import { metaCostoUsd } from "./meta-estimado";

describe("metaCostoUsd", () => {
  it("reproduce el cobro real de Meta del primer mes (Notion «Gastos CRM Sep/Oct»: US$36.25 con IVA)", () => {
    // Los 2,498 mensajes cobrables del 22-sep al 23-oct que contó el CRM y que cobró Meta.
    const usd = metaCostoUsd({ marketing: 312, utilidad: 47, servicio: 2139 });
    expect(usd).toBeCloseTo(36.41, 2);
    expect(Math.abs(usd / 36.25 - 1)).toBeLessThan(0.01);
  });
});
