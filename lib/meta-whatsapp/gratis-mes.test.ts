import { describe, expect, it } from "vitest";
import { gratisQueQuedan, mesUtc } from "./gratis-mes";

const now = new Date("2026-11-05T15:00:00Z");
const recien = new Date("2026-11-05T14:10:00Z");

describe("mesUtc", () => {
  it("primer y último día del mes en UTC", () => {
    expect(mesUtc(now)).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(mesUtc(new Date("2026-12-31T23:59:00Z"))).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});

describe("gratisQueQuedan", () => {
  it("1,000 menos los gratis de servicio que ya contó Meta este mes", () => {
    const renglones = [
      { category: "service", pricingType: "free_customer_service", volume: 300 },
      { category: "service", pricingType: "free_customer_service", volume: 120 },
      { category: "marketing", pricingType: "regular", volume: 40 },
      { category: "service", pricingType: "free_entry_point", volume: 90 },
    ];
    expect(gratisQueQuedan(renglones, recien, now)).toBe(580);
  });

  it("sin renglones pero con lectura reciente: quedan los 1,000", () => {
    expect(gratisQueQuedan([], recien, now)).toBe(1000);
  });

  it("si Meta ya cobró algún mensaje de servicio, no queda ninguno", () => {
    expect(gratisQueQuedan([{ category: "service", pricingType: "regular", volume: 3 }], recien, now)).toBe(0);
  });

  it("nunca menos de 0", () => {
    expect(gratisQueQuedan([{ category: "service", pricingType: "free_customer_service", volume: 1200 }], recien, now)).toBe(0);
  });

  it("sin lectura de Meta o con una de más de 6 h: no se sabe", () => {
    expect(gratisQueQuedan([], null, now)).toBeNull();
    expect(gratisQueQuedan([], new Date("2026-11-05T08:59:00Z"), now)).toBeNull();
  });
});
