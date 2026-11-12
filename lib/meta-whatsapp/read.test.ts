import { describe, expect, it, vi } from "vitest";
import { parseMetaPricing, pricingRange, readMetaPricing } from "./read";

describe("parseMetaPricing", () => {
  it("un renglón por día UTC, categoría y tipo; suma si Meta los parte (país o nivel)", () => {
    const rows = parseMetaPricing({
      accountId: "acc",
      dataPoints: [
        { start: "2026-10-01T00:00:00Z", end: "2026-10-02T00:00:00Z", pricingCategory: "MARKETING", pricingType: "REGULAR", volume: 10, cost: 0.407 },
        { start: "2026-10-01T00:00:00Z", end: "2026-10-02T00:00:00Z", pricingCategory: "MARKETING", pricingType: "REGULAR", volume: 2, cost: 0.0814 },
        { start: "2026-10-01T00:00:00Z", end: "2026-10-02T00:00:00Z", pricingCategory: "SERVICE", pricingType: "FREE_ENTRY_POINT", volume: 300, cost: 0 },
        { start: "2026-10-02T00:00:00Z", end: "2026-10-03T00:00:00Z", pricingCategory: null, pricingType: null, volume: 1, cost: null },
        { start: "no es fecha", pricingCategory: "SERVICE", pricingType: "REGULAR", volume: 5, cost: 1 },
      ],
    });
    expect(rows).toEqual([
      { day: "2026-10-01", category: "marketing", pricingType: "regular", volume: 12, costUsd: 0.4884 },
      { day: "2026-10-01", category: "service", pricingType: "free_entry_point", volume: 300, costUsd: 0 },
      { day: "2026-10-02", category: "desconocida", pricingType: "desconocida", volume: 1, costUsd: null },
    ]);
  });

  it("una respuesta sin dataPoints es un error (no se guarda nada)", () => {
    expect(() => parseMetaPricing({ error: "x" })).toThrow();
  });
});

describe("pricingRange", () => {
  it("desde el día 1 del mes anterior (UTC) hasta ahora; en enero, desde diciembre", () => {
    expect(pricingRange(new Date("2026-11-04T18:00:00Z"))).toEqual({ start: "2026-10-01", end: "2026-11-04T18:00:00.000Z" });
    expect(pricingRange(new Date("2027-01-01T00:30:00Z")).start).toBe("2026-12-01");
  });
});

describe("readMetaPricing", () => {
  it("pide a Zernio por día, por categoría y tipo, con la llave en el encabezado", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ dataPoints: [] }), { status: 200 }));
    await readMetaPricing({ apiKey: "sk-x", baseUrl: "https://zernio.com/api" }, "acc_1", { start: "2026-10-01", end: "2026-11-04T00:00:00.000Z" }, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    const u = new URL(url);
    expect(u.pathname).toBe("/api/v1/whatsapp/pricing-analytics");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      accountId: "acc_1",
      start: "2026-10-01",
      end: "2026-11-04T00:00:00.000Z",
      granularity: "DAILY",
      dimensions: "PRICING_CATEGORY,PRICING_TYPE",
      metricTypes: "VOLUME",
    });
    expect(init.headers.Authorization).toBe("Bearer sk-x");
  });

  it("Meta solo da mensajes: el costo sale de la tarifa por mensaje (cobrados) y los gratis valen 0", async () => {
    const body = {
      dataPoints: [
        { start: "2026-10-31T00:00:00Z", pricingCategory: "SERVICE", pricingType: "REGULAR", volume: 2571, cost: null },
        { start: "2026-10-31T00:00:00Z", pricingCategory: "MARKETING", pricingType: "REGULAR", volume: 345, cost: null },
        { start: "2026-10-31T00:00:00Z", pricingCategory: "UTILITY", pricingType: "REGULAR", volume: 69, cost: null },
        { start: "2026-10-31T00:00:00Z", pricingCategory: "SERVICE", pricingType: "FREE_ENTRY_POINT", volume: 14994, cost: null },
        { start: "2026-10-31T00:00:00Z", pricingCategory: "RARA", pricingType: "REGULAR", volume: 2, cost: null },
      ],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const rows = await readMetaPricing({ apiKey: "k", baseUrl: "https://zernio.com/api" }, "acc", { start: "2026-10-01", end: "2026-11-01" }, { fetchImpl });
    const cost = Object.fromEntries(rows.map((r) => [`${r.category}/${r.pricingType}`, r.costUsd]));
    // Octubre: 29.47 + 14.04 + 0.58 = 44.09, lo mismo que dio la página de Meta.
    expect(cost).toEqual({ "service/regular": 29.471373, "marketing/regular": 14.04012, "utility/regular": 0.580014, "service/free_entry_point": 0, "rara/regular": null });
  });

  it("si Zernio responde error, el mensaje no trae la llave", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad key sk-x", { status: 401 }));
    await expect(
      readMetaPricing({ apiKey: "sk-x", baseUrl: "https://zernio.com/api" }, "acc", { start: "2026-10-01", end: "2026-11-01" }, { fetchImpl }),
    ).rejects.toThrow(/401: bad key \[llave oculta\]/);
  });
});
