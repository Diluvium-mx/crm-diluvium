import { describe, expect, it } from "vitest";
import { billingAlertFor, summarizeZernio, zernioFreshness } from "./zernio";

const base = {
  periodStart: new Date("2026-10-01T00:00:00Z"),
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
      prevTotalUsd: 0,
      prevMonthLabel: "septiembre",
      billingAlert: null,
      updatedMinutesAgo: 3,
      lastError: null,
    });
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
