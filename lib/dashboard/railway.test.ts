import { describe, expect, it } from "vitest";
import { billingAlertFor, railwayFreshness, shortDate, summarizeRailway } from "./railway";

const START = new Date("2026-10-05T23:44:44.000Z");
const END = new Date("2026-11-05T23:44:44.000Z");
const base = { plan: "HOBBY", state: "ACTIVE", periodStart: START, periodEnd: END, usageUsd: 0.6928, fetchedAt: null, lastError: null };

describe("summarizeRailway", () => {
  it("Hobby: uso, lo que queda de los US$5 y la factura proyectada (caso real del 7-oct)", () => {
    const now = new Date("2026-10-07T18:53:23Z");
    const s = summarizeRailway({ ...base, fetchedAt: new Date("2026-10-07T18:52:00Z") }, now);
    expect(s).toMatchObject({
      planLabel: "Hobby",
      periodStartLabel: "5-oct",
      periodEndLabel: "5-nov",
      usageUsd: 0.69,
      includedUsd: 5,
      includedLeftUsd: 4.31,
      includedTone: "navy",
      overUsd: 0,
      updatedMinutesAgo: 1,
    });
    expect(Math.floor(s.includedPct ?? 0)).toBe(13);
    // 0.6928 en 1.80 de 31 días ≈ US$11.94 al cierre.
    expect(s.estimatedBillUsd).toBeCloseTo(11.94, 1);
  });

  it("la factura nunca baja de lo que cuesta el plan", () => {
    const s = summarizeRailway({ ...base, usageUsd: 0.5 }, new Date("2026-10-20T23:44:44Z"));
    expect(s.estimatedBillUsd).toBe(5);
  });

  it("el primer día no hay estimación (brinca demasiado)", () => {
    const s = summarizeRailway(base, new Date("2026-10-06T20:00:00Z"));
    expect(s.estimatedBillUsd).toBeNull();
  });

  it("pasado lo incluido: barra llena en naranja y lo que se cobrará aparte", () => {
    const s = summarizeRailway({ ...base, usageUsd: 6.4 }, new Date("2026-10-25T23:44:44Z"));
    expect(s).toMatchObject({ includedLeftUsd: 0, includedPct: 100, includedTone: "orange", overUsd: 1.4 });
  });

  it("después del corte la proyección se queda en el periodo completo", () => {
    const s = summarizeRailway({ ...base, usageUsd: 12 }, new Date("2026-11-06T10:00:00Z"));
    expect(s.estimatedBillUsd).toBe(12);
  });

  it("plan sin uso incluido o sin lectura: sin barra", () => {
    expect(summarizeRailway({ ...base, plan: "FREE" }, new Date("2026-10-07T00:00:00Z"))).toMatchObject({
      planLabel: "Free",
      includedUsd: null,
      includedPct: null,
    });
    const vacio = summarizeRailway(
      { plan: null, state: null, periodStart: null, periodEnd: null, usageUsd: null, fetchedAt: null, lastError: "Railway respondió 401" },
      new Date(),
    );
    expect(vacio).toMatchObject({ planLabel: null, usageUsd: null, includedPct: null, estimatedBillUsd: null });
  });
});

describe("aviso de cobro", () => {
  it("al corriente o sin lectura: sin aviso", () => {
    expect(summarizeRailway(base, new Date("2026-10-07T19:00:00Z")).billingAlert).toBeNull();
    expect(billingAlertFor(null)).toBeNull();
  });

  it("pago vencido o sin pagar: aviso de pago pendiente", () => {
    expect(summarizeRailway({ ...base, state: "PAST_DUE" }, new Date("2026-11-06T10:00:00Z")).billingAlert).toContain("pago pendiente");
    expect(billingAlertFor("UNPAID")).toContain("pago pendiente");
  });

  it("plan cancelado o inactivo: aviso propio", () => {
    expect(billingAlertFor("CANCELLED")).toContain("cancelado o inactivo");
    expect(billingAlertFor("INACTIVE")).toContain("cancelado o inactivo");
  });
});

describe("shortDate", () => {
  it("usa la hora de Mazatlán", () => {
    // 5-nov 03:00 UTC = 4-nov 20:00 en Mazatlán.
    expect(shortDate(new Date("2026-11-05T03:00:00Z"))).toBe("4-nov");
  });
});

describe("railwayFreshness", () => {
  it("al día, vieja o con error", () => {
    expect(railwayFreshness({ updatedMinutesAgo: 3, lastError: null })).toEqual({ text: "Actualizado hace 3 min", tone: "muted" });
    expect(railwayFreshness({ updatedMinutesAgo: 130, lastError: null })).toEqual({ text: "Sin actualizar desde hace 2 h", tone: "orange" });
    expect(railwayFreshness({ updatedMinutesAgo: 4, lastError: "x" }).tone).toBe("orange");
    expect(railwayFreshness({ updatedMinutesAgo: null, lastError: "x" })).toEqual({ text: "No se pudo leer de Railway", tone: "orange" });
  });
});
