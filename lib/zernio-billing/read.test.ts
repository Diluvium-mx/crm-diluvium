import { describe, expect, it } from "vitest";
import { parseZernioBillingStatus, parseZernioUsage, readZernioBilling, zernioBillingConfigFromEnv, type GetLike } from "./read";

const CONFIG = { apiKey: "sk-secreto", baseUrl: "https://zernio.com/api" };

// Forma real de `/v1/usage?range=cycle` (23-oct-2026; sin `days` ni `lineItems`, que no se usan).
const CICLO = {
  supported: true,
  granularity: "day",
  period: { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", source: "cycle" },
  totals: { accounts: 0, numbers: 0, calls: 0, sms: 0, messages: 0.71, ads: 0, credits: 0, other: 0, total: 0.71 },
};
const ANTERIOR = {
  supported: true,
  period: { start: "2026-09-18T19:00:00.000Z", end: "2026-10-01T00:00:00.000Z", source: "cycle" },
  totals: { accounts: 0, messages: 0, total: 0 },
};
// Forma real de `/v1/billing` (23-oct-2026).
const COBRO = {
  billingSystem: "metronome",
  plan: { name: "Usage", isUsageBased: true, isPaid: true },
  balance: { accruedThisPeriodCents: 71, creditsRemainingCents: 0 },
  status: { hasAccess: true, suspended: false, suspendedAt: null, declineReason: null, openInvoiceUrl: null },
};

describe("zernioBillingConfigFromEnv", () => {
  it("necesita la llave; la base es la de siempre o ZERNIO_BASE_URL", () => {
    expect(zernioBillingConfigFromEnv({})).toBeNull();
    expect(zernioBillingConfigFromEnv({ ZERNIO_API_KEY: " k " })).toEqual({ apiKey: "k", baseUrl: "https://zernio.com/api" });
    expect(zernioBillingConfigFromEnv({ ZERNIO_API_KEY: "k", ZERNIO_BASE_URL: "http://localhost:9999/api/" })).toEqual({
      apiKey: "k",
      baseUrl: "http://localhost:9999/api",
    });
  });
});

describe("parseZernioUsage", () => {
  it("lee el mes y lo que va por mensajes y cuentas (caso real del 23-oct)", () => {
    expect(parseZernioUsage(CICLO)).toEqual({
      periodStart: new Date("2026-10-01T00:00:00.000Z"),
      periodEnd: new Date("2026-11-01T00:00:00.000Z"),
      totalUsd: 0.71,
      messagesUsd: 0.71,
      accountsUsd: 0,
    });
  });

  it("falla claro si Zernio no da el consumo o no trae totales", () => {
    expect(() => parseZernioUsage({ supported: false })).toThrow("no da el consumo");
    expect(() => parseZernioUsage({ supported: true })).toThrow("no devolvió los totales");
  });
});

describe("parseZernioBillingStatus", () => {
  it("al corriente: sin aviso", () => {
    expect(parseZernioBillingStatus(COBRO)).toEqual({ suspended: false, declineReason: null, openInvoice: false });
  });

  it("suspendida o sin acceso cuenta como suspendida", () => {
    expect(parseZernioBillingStatus({ status: { suspended: true } }).suspended).toBe(true);
    expect(parseZernioBillingStatus({ status: { hasAccess: false, suspended: false } }).suspended).toBe(true);
  });

  it("tarjeta rechazada y factura abierta (sin guardar el enlace)", () => {
    expect(parseZernioBillingStatus({ status: { declineReason: " card_declined ", openInvoiceUrl: "https://pago.example/x" } })).toEqual({
      suspended: false,
      declineReason: "card_declined",
      openInvoice: true,
    });
  });
});

describe("readZernioBilling", () => {
  function fakeFetch(responses: Record<string, Response>) {
    const calls: Parameters<GetLike>[] = [];
    const fetchImpl: GetLike = async (...args) => {
      calls.push(args);
      const path = args[0].slice(CONFIG.baseUrl.length);
      return responses[path]?.clone() ?? new Response("no", { status: 404 });
    };
    return { calls, fetchImpl };
  }

  it("lee el mes, el anterior y el estado con la llave en el encabezado", async () => {
    const { calls, fetchImpl } = fakeFetch({
      "/v1/usage?range=cycle": new Response(JSON.stringify(CICLO)),
      "/v1/usage?range=prev-cycle": new Response(JSON.stringify(ANTERIOR)),
      "/v1/billing": new Response(JSON.stringify(COBRO)),
    });
    const reading = await readZernioBilling(CONFIG, { fetchImpl });
    expect(calls.map(([url]) => url.slice(CONFIG.baseUrl.length)).sort()).toEqual([
      "/v1/billing",
      "/v1/usage?range=cycle",
      "/v1/usage?range=prev-cycle",
    ]);
    for (const [url, init] of calls) {
      expect(url).not.toContain("sk-secreto");
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe("Bearer sk-secreto");
    }
    expect(reading).toMatchObject({ totalUsd: 0.71, prevTotalUsd: 0, prevPeriodStart: new Date("2026-09-18T19:00:00.000Z"), suspended: false });
  });

  it("si falla el mes anterior, la lectura sale igual sin él", async () => {
    const { fetchImpl } = fakeFetch({
      "/v1/usage?range=cycle": new Response(JSON.stringify(CICLO)),
      "/v1/billing": new Response(JSON.stringify(COBRO)),
    });
    await expect(readZernioBilling(CONFIG, { fetchImpl })).resolves.toMatchObject({ totalUsd: 0.71, prevTotalUsd: null, prevPeriodStart: null });
  });

  it("un error HTTP no lleva la llave", async () => {
    const { fetchImpl } = fakeFetch({
      "/v1/usage?range=cycle": new Response("llave sk-secreto inválida", { status: 401 }),
      "/v1/billing": new Response(JSON.stringify(COBRO)),
    });
    await expect(readZernioBilling(CONFIG, { fetchImpl })).rejects.toThrow("Zernio respondió 401: llave [llave oculta] inválida");
  });
});
