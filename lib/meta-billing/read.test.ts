import { describe, expect, it } from "vitest";
import { metaBillingConfigFromEnv, parsePricingAnalytics, readMetaPricing } from "./read";
import { mergePricingDays, previousMonthStart } from "./days";

const day1 = Date.UTC(2026, 9, 1) / 1000;
const day2 = Date.UTC(2026, 9, 2) / 1000;

describe("parsePricingAnalytics", () => {
  it("agrupa por día UTC, tipo y categoría", () => {
    const r = parsePricingAnalytics({
      currency: "USD",
      pricing_analytics: {
        data: [
          {
            data_points: [
              { start: day1, end: day2, volume: 3, cost: 0.0345, pricing_type: "REGULAR", pricing_category: "SERVICE" },
              { start: day1, end: day2, volume: 2, cost: 0.01, pricing_type: "REGULAR", pricing_category: "SERVICE" },
              { start: day1, end: day2, volume: 500, cost: 0, pricing_type: "FREE_ENTRY_POINT", pricing_category: "SERVICE" },
              { start: day2, end: day2 + 86400, volume: 1, cost: 0.04, pricing_type: "REGULAR", pricing_category: "MARKETING" },
              { start: day2, end: day2 + 86400, volume: 0, cost: 0, pricing_type: "REGULAR", pricing_category: "UTILITY" },
            ],
          },
        ],
      },
    });
    expect(r.currency).toBe("USD");
    expect(r.days["2026-10-01"].REGULAR.SERVICE).toEqual({ volume: 5, cost: 0.0445 });
    expect(r.days["2026-10-01"].FREE_ENTRY_POINT.SERVICE.volume).toBe(500);
    expect(r.days["2026-10-02"]).toEqual({ REGULAR: { MARKETING: { volume: 1, cost: 0.04 } } });
  });

  it("tolera respuestas vacías o raras", () => {
    expect(parsePricingAnalytics({})).toEqual({ currency: null, days: {} });
    expect(parsePricingAnalytics({ currency: "x", pricing_analytics: { data: [{ data_points: [{ start: "nope" }] }] } }).days).toEqual({});
    const odd = parsePricingAnalytics({ pricing_analytics: { data: [{ data_points: [{ start: day1, volume: 1, cost: "0.5", pricing_type: "<b>" }] }] } });
    expect(odd.days["2026-10-01"].SIN_TIPO.SIN_CATEGORIA).toEqual({ volume: 1, cost: 0.5 });
  });
});

describe("metaBillingConfigFromEnv", () => {
  it("pide token e id numérico", () => {
    expect(metaBillingConfigFromEnv({})).toBeNull();
    expect(metaBillingConfigFromEnv({ META_WHATSAPP_TOKEN: "t", META_WABA_ID: "abc" })).toBeNull();
    const c = metaBillingConfigFromEnv({ META_WHATSAPP_TOKEN: " t ", META_WABA_ID: "123" });
    expect(c?.wabaId).toBe("123");
    expect(c?.api.token).toBe("t");
  });
});

describe("readMetaPricing", () => {
  it("pide currency + pricing_analytics diario con el token en la cabecera", async () => {
    let url = "";
    let auth = "";
    const fetchImpl = (async (u: string, init: { headers: Record<string, string> }) => {
      url = u;
      auth = init.headers.Authorization;
      return new Response(JSON.stringify({ currency: "USD", pricing_analytics: { data: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    await readMetaPricing({ wabaId: "123", api: { token: "tok", fetchImpl } }, { now: new Date("2026-10-05T12:00:00Z"), fromDay: "2026-09-01" });
    const fields = new URL(url).searchParams.get("fields") ?? "";
    expect(url).toContain("/123?");
    expect(url).not.toContain("tok");
    expect(auth).toBe("Bearer tok");
    expect(fields).toContain(`start(${Date.UTC(2026, 8, 1) / 1000})`);
    expect(fields).toContain(`end(${Date.UTC(2026, 9, 6) / 1000})`);
    expect(fields).toContain("granularity(DAILY)");
    expect(fields.startsWith("currency,")).toBe(true);
  });
});

describe("días", () => {
  it("mes anterior, también en enero", () => {
    expect(previousMonthStart(new Date("2026-10-05T00:00:00Z"))).toBe("2026-09-01");
    expect(previousMonthStart(new Date("2027-01-31T23:00:00Z"))).toBe("2026-12-01");
  });
  it("la lectura nueva manda desde replaceFrom", () => {
    const cell = (v: number) => ({ REGULAR: { SERVICE: { volume: v, cost: 0 } } });
    const merged = mergePricingDays({ "2026-08-31": cell(1), "2026-09-02": cell(2), "2026-09-03": cell(3) }, { "2026-09-02": cell(9) }, "2026-09-01");
    expect(merged).toEqual({ "2026-08-31": cell(1), "2026-09-02": cell(9) });
  });
});
