import { describe, expect, it } from "vitest";
import { metaFreshness, summarizeMetaWhatsapp } from "./meta-whatsapp";

const now = new Date("2026-10-05T18:00:00Z");

describe("summarizeMetaWhatsapp", () => {
  it("separa el mes, el mes anterior, lo cobrado y lo gratis", () => {
    const s = summarizeMetaWhatsapp(
      {
        currency: "USD",
        fetchedAt: new Date("2026-10-05T17:30:00Z"),
        lastError: null,
        days: {
          "2026-08-31": { REGULAR: { MARKETING: { volume: 9, cost: 9 } } },
          "2026-09-20": { REGULAR: { MARKETING: { volume: 1, cost: 0.04 } } },
          "2026-10-02": {
            REGULAR: { MARKETING: { volume: 1, cost: 0.04 }, SERVICE: { volume: 100, cost: 0 } },
            FREE_ENTRY_POINT: { SERVICE: { volume: 500, cost: 0 } },
            FREE_CUSTOMER_SERVICE: { UTILITY: { volume: 7, cost: 0 } },
            NUEVO: { SERVICE: { volume: 2, cost: 0 } },
          },
          "2026-10-05": { REGULAR: { SERVICE: { volume: 20, cost: 0.23 } } },
        },
      },
      now,
    );
    expect(s.monthCost).toBe(0.27);
    expect(s.previousMonthCost).toBe(0.04);
    expect(s.charged).toBe(121);
    expect(s.freeAd).toBe(500);
    expect(s.freeService).toBe(7);
    expect(s.freeOther).toBe(2);
    expect(s.byCategory).toEqual([
      { label: "Servicio (respuestas)", volume: 120, cost: 0.23 },
      { label: "Marketing", volume: 1, cost: 0.04 },
    ]);
    expect(s.updatedMinutesAgo).toBe(30);
    expect(s.monthLabel).toContain("octubre");
  });

  it("sin moneda usa USD", () => {
    expect(summarizeMetaWhatsapp({ currency: null, days: {}, fetchedAt: null, lastError: null }, now).currency).toBe("USD");
  });
});

describe("metaFreshness", () => {
  it("avisa en naranja si está vieja, con error o sin leer", () => {
    expect(metaFreshness({ updatedMinutesAgo: 30, lastError: null })).toEqual({ text: "Actualizado hace 30 min", tone: "muted" });
    expect(metaFreshness({ updatedMinutesAgo: 200, lastError: null }).tone).toBe("orange");
    expect(metaFreshness({ updatedMinutesAgo: 5, lastError: "x" }).tone).toBe("orange");
    expect(metaFreshness({ updatedMinutesAgo: null, lastError: "x" }).text).toBe("No se pudo leer de Meta");
  });
});
