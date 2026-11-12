import { describe, expect, it } from "vitest";
import { metaFreshness, ratesFrom, summarizeMetaMonth } from "./meta-whatsapp";

const now = new Date("2026-11-04T18:00:00Z");

describe("summarizeMetaMonth", () => {
  it("lo que va del mes (UTC) y el mes anterior; sin renglones del mes anterior no sale", () => {
    const rows = [
      { day: "2026-10-31", category: "service", pricingType: "regular", volume: 100, costUsd: 1.15 },
      { day: "2026-11-01", category: "marketing", pricingType: "regular", volume: 2, costUsd: 0.0814 },
      { day: "2026-11-02", category: "service", pricingType: "free_entry_point", volume: 50, costUsd: 0 },
    ];
    const s = summarizeMetaMonth(rows, { fetchedAt: new Date("2026-11-04T17:30:00Z"), lastError: null }, now);
    expect(s).toEqual({
      monthLabel: "noviembre",
      totalUsd: 0.08,
      charged: 2,
      prevMonthLabel: "octubre",
      prevTotalUsd: 1.15,
      updatedMinutesAgo: 30,
      lastError: null,
    });
    expect(summarizeMetaMonth(rows.slice(1), null, now).prevTotalUsd).toBeNull();
  });

  it("sin renglones: US$0 si Meta ya se leyó bien; sin dato si nunca se ha podido leer", () => {
    expect(summarizeMetaMonth([], { fetchedAt: new Date("2026-11-04T17:00:00Z"), lastError: null }, now).totalUsd).toBe(0);
    expect(summarizeMetaMonth([], { fetchedAt: null, lastError: "404" }, now).totalUsd).toBeNull();
  });

  it("si Meta no dio el costo, el monto queda sin dato (no en cero)", () => {
    const s = summarizeMetaMonth([{ day: "2026-11-01", category: "service", pricingType: "regular", volume: 3, costUsd: null }], null, now);
    expect(s.totalUsd).toBeNull();
    expect(s.charged).toBe(3);
  });
});

describe("ratesFrom", () => {
  it("lo que cobró Meta en promedio por mensaje de cada tipo; sin cobrados, el de octubre", () => {
    const r = ratesFrom([
      { day: "2026-11-01", category: "service", pricingType: "regular", volume: 4, costUsd: 0.048 },
      { day: "2026-11-01", category: "service", pricingType: "free_entry_point", volume: 400, costUsd: 0 },
    ]);
    expect(r.service).toBeCloseTo(0.012, 6);
    expect(r.marketing).toBe(0.040696);
    expect(r.utility).toBe(0.008406);
  });
});

describe("metaFreshness", () => {
  it("al día, viejo (más de 3 h) o con error", () => {
    expect(metaFreshness({ updatedMinutesAgo: 20, lastError: null })).toEqual({ text: "Actualizado hace 20 min", tone: "muted" });
    expect(metaFreshness({ updatedMinutesAgo: 240, lastError: null })).toEqual({ text: "Sin actualizar desde hace 4 h", tone: "orange" });
    expect(metaFreshness({ updatedMinutesAgo: null, lastError: "x" }).text).toBe("No se pudo leer el cobro de Meta");
  });
});
