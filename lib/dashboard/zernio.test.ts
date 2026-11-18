import { describe, expect, it } from "vitest";
import { billingAlertFor, estimateZernioBill, summarizeZernio, zernioFreshness } from "./zernio";

const base = {
  periodStart: new Date("2026-10-01T00:00:00Z"),
  periodEnd: new Date("2026-11-01T00:00:00Z"),
  totalUsd: 0.71,
  messagesUsd: 0.71,
  accountsUsd: 0,
  prevTotalUsd: 0,
  prevPeriodStart: new Date("2026-09-18T19:00:00Z"),
  suspended: false,
  declineReason: null,
  openInvoice: false,
  fetchedAt: new Date("2026-10-23T18:00:00Z"),
  lastError: null,
};

describe("summarizeZernio", () => {
  it("lo que va del mes, por mensajes y cuentas, y el mes anterior (caso real del 23-oct)", () => {
    const s = summarizeZernio(base, new Date("2026-10-23T18:03:30Z"));
    expect(s).toEqual({
      monthLabel: "octubre",
      totalUsd: 0.71,
      messagesUsd: 0.71,
      accountsUsd: 0,
      otherUsd: 0,
      sentCount: null,
      freePct: null,
      estimatedBillUsd: null,
      prevTotalUsd: 0,
      prevMonthLabel: "septiembre",
      billingAlert: null,
      updatedMinutesAgo: 3,
      lastError: null,
    });
  });

  it("con el conteo de la base: mensajes contra los 10,000 gratis y la factura estimada", () => {
    const s = summarizeZernio(base, new Date("2026-10-23T18:00:00Z"), 17_261);
    expect(s.sentCount).toBe(17_261);
    expect(s.freePct).toBe(100);
    expect(s.estimatedBillUsd).toBe(1.35);
    expect(summarizeZernio(base, new Date("2026-10-05T00:00:00Z"), 2_500).freePct).toBe(25);
  });

  it("el mes sale en días UTC: el 1.º a las 00:00 UTC ya es el mes nuevo", () => {
    expect(summarizeZernio({ ...base, periodStart: new Date("2026-11-01T00:00:00Z") }, new Date()).monthLabel).toBe("noviembre");
  });

  it("otros conceptos (números, llamadas…) se separan de mensajes y cuentas", () => {
    const s = summarizeZernio({ ...base, totalUsd: 4.21, messagesUsd: 0.71, accountsUsd: 0.5 }, new Date());
    expect(s.otherUsd).toBe(3);
  });

  it("sin lectura buena: cifras vacías y el error a la vista", () => {
    const s = summarizeZernio(
      { ...base, periodStart: null, totalUsd: null, messagesUsd: null, accountsUsd: null, prevTotalUsd: null, prevPeriodStart: null, fetchedAt: null, lastError: "Zernio respondió 401" },
      new Date(),
    );
    expect(s).toMatchObject({ monthLabel: null, totalUsd: null, otherUsd: 0, prevMonthLabel: null, updatedMinutesAgo: null });
  });
});

describe("billingAlertFor", () => {
  it("al corriente no avisa", () => {
    expect(billingAlertFor({ suspended: false, declineReason: null, openInvoice: false })).toBeNull();
  });

  it("cuenta suspendida: avisa que no entran ni salen mensajes", () => {
    expect(billingAlertFor({ suspended: true, declineReason: null, openInvoice: false })).toContain("suspendió la cuenta");
  });

  it("tarjeta rechazada o factura abierta: pago pendiente", () => {
    expect(billingAlertFor({ suspended: false, declineReason: "card_declined", openInvoice: false })).toContain("pago pendiente");
    expect(billingAlertFor({ suspended: false, declineReason: null, openInvoice: true })).toContain("pago pendiente");
  });
});

describe("zernioFreshness", () => {
  it("al día, viejo (45 min) o con error", () => {
    expect(zernioFreshness({ updatedMinutesAgo: 10, lastError: null })).toEqual({ text: "Actualizado hace 10 min", tone: "muted" });
    expect(zernioFreshness({ updatedMinutesAgo: 50, lastError: null })).toEqual({ text: "Sin actualizar desde hace 50 min", tone: "orange" });
    expect(zernioFreshness({ updatedMinutesAgo: 130, lastError: "x" })).toEqual({ text: "Sin actualizar desde hace 2 h", tone: "orange" });
    expect(zernioFreshness({ updatedMinutesAgo: null, lastError: "x" })).toEqual({ text: "No se pudo leer de Zernio", tone: "orange" });
    expect(zernioFreshness({ updatedMinutesAgo: null, lastError: null })).toEqual({ text: "Aún sin leer", tone: "orange" });
  });
});

describe("estimateZernioBill", () => {
  const nov = { periodStart: new Date("2026-11-01T00:00:00Z"), periodEnd: new Date("2026-12-01T00:00:00Z") };

  it("octubre completo cuadra con la factura real (20,737 en la base → US$1.07; Zernio cobró 1.05 + 0.03 que anotó el 1-nov)", () => {
    const oct = { periodStart: base.periodStart, periodEnd: base.periodEnd, totalUsd: 1.05, messagesUsd: 1.05 };
    expect(estimateZernioBill(oct, 20_737, new Date("2026-11-01T00:00:00Z"))).toBe(1.07);
  });

  it("noviembre al ritmo de los primeros 2 días: 1,070 enviados → ≈15,700 al mes → US$0.57", () => {
    expect(estimateZernioBill({ ...nov, totalUsd: 0.03, messagesUsd: 0.03 }, 1_070, new Date("2026-11-03T01:10:00Z"))).toBe(0.57);
  });

  it("el primer día no se proyecta, ni sin conteo o sin periodo", () => {
    const row = { ...nov, totalUsd: 0.03, messagesUsd: 0.03 };
    expect(estimateZernioBill(row, 327, new Date("2026-11-01T23:00:00Z"))).toBeNull();
    expect(estimateZernioBill(row, null, new Date("2026-11-10T00:00:00Z"))).toBeNull();
    expect(estimateZernioBill({ ...row, periodEnd: null }, 327, new Date("2026-11-10T00:00:00Z"))).toBeNull();
  });

  it("si no pasan de los 10,000 gratis la factura es lo que no son mensajes (con 2 cuentas, US$0)", () => {
    expect(estimateZernioBill({ ...nov, totalUsd: 0, messagesUsd: 0 }, 2_000, new Date("2026-11-11T00:00:00Z"))).toBe(0);
  });

  it("nunca menos de lo que Zernio ya cobra, y suma las cuentas fuera del crédito tal como van", () => {
    // Pocos mensajes al cierre pero Zernio ya anotó US$0.40: se queda en 0.40.
    expect(estimateZernioBill({ ...nov, totalUsd: 0.4, messagesUsd: 0.4 }, 9_000, new Date("2026-12-01T00:00:00Z"))).toBe(0.4);
    // Una 3.ª cuenta cobra US$2 hasta hoy: se suma a la proyección de mensajes.
    expect(estimateZernioBill({ ...nov, totalUsd: 2, messagesUsd: 0 }, 10_000, new Date("2026-11-16T00:00:00Z"))).toBe(3);
  });
});
