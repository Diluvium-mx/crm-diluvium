import { describe, expect, it } from "vitest";
import type { AiSpendSummary, ProviderSpend } from "./ai-spend";
import { iaTile, isIdleProvider, metaTile, railwayTile, zernioTile } from "./costo-tiles";
import type { MetaWhatsappSummary } from "./meta-whatsapp";
import type { RailwaySummary } from "./railway";
import type { ZernioSummary } from "./zernio";

function provider(p: Partial<ProviderSpend>): ProviderSpend {
  return {
    provider: "anthropic",
    label: "Anthropic",
    monthUsd: 0,
    monthProdUsd: 0,
    monthTestsUsd: 0,
    source: "proveedor",
    updatedMinutesAgo: 2,
    lastError: null,
    loadedUsd: null,
    firstTopupOn: null,
    spentSinceFirstUsd: null,
    balanceUsd: null,
    plan: null,
    monthPlanUsd: 0,
    ...p,
  };
}

const anthropic = provider({ monthUsd: 15.2, loadedUsd: 20, spentSinceFirstUsd: 11.23, balanceUsd: 8.77 });
const openai = provider({ provider: "openai", label: "OpenAI", monthUsd: 6.3, loadedUsd: 10, spentSinceFirstUsd: 1.1, balanceUsd: 8.9 });
const xai = provider({ provider: "xai", label: "xAI", loadedUsd: 5, spentSinceFirstUsd: 0, balanceUsd: 5 });
const google = provider({ provider: "google", label: "Google", source: "estimado", updatedMinutesAgo: null });
const ai = (providers: ProviderSpend[]): AiSpendSummary => ({ monthLabel: "noviembre de 2026", providers, topups: [] });

describe("isIdleProvider", () => {
  it("sin gasto y sin nada que avisar = va en la línea de «sin gasto»", () => {
    expect(isIdleProvider(xai)).toBe(true);
    expect(isIdleProvider(google)).toBe(true);
    expect(isIdleProvider(anthropic)).toBe(false);
  });
  it("con la lectura vieja, con error o sin saldo sigue a la vista", () => {
    expect(isIdleProvider({ ...xai, updatedMinutesAgo: 45 })).toBe(false);
    expect(isIdleProvider({ ...xai, lastError: "401" })).toBe(false);
    expect(isIdleProvider({ ...xai, balanceUsd: 0, spentSinceFirstUsd: 5 })).toBe(false);
  });
});

describe("iaTile", () => {
  it("gasto del mes y el saldo más bajo de los que gastan", () => {
    expect(iaTile(ai([anthropic, openai, xai, google]))).toEqual({ value: "US$21.50", sub: "Saldo más bajo: US$8.77 (Anthropic)", tone: "muted" });
  });
  it("saldo bajo (80 % usado o más) en naranja", () => {
    const low = { ...anthropic, spentSinceFirstUsd: 18, balanceUsd: 2 };
    expect(iaTile(ai([low, openai])).tone).toBe("orange");
  });
  it("una lectura vieja manda sobre el saldo", () => {
    expect(iaTile(ai([anthropic, { ...openai, updatedMinutesAgo: 120 }]))).toMatchObject({ sub: "OpenAI: sin actualizar desde hace 2 h", tone: "orange" });
  });
  it("sin recargas pide registrar una", () => {
    expect(iaTile(ai([provider({ monthUsd: 1 })])).sub).toBe("Registra una recarga para ver el saldo");
  });
});

describe("metaTile / railwayTile / zernioTile", () => {
  const meta = { monthLabel: "noviembre", totalUsd: 23.6, charged: 412, prevMonthLabel: "octubre", prevTotalUsd: 44.16, updatedMinutesAgo: 30, lastError: null } satisfies MetaWhatsappSummary;
  it("Meta: monto y mensajes cobrados; lectura vieja en naranja", () => {
    expect(metaTile(meta)).toEqual({ value: "US$23.60", sub: "412 mensajes cobrados", tone: "muted" });
    expect(metaTile({ ...meta, updatedMinutesAgo: 400 }).tone).toBe("orange");
  });

  const railway = { estimatedBillUsd: 6.1, usageUsd: 2.4, periodEndLabel: "5-dic", billingAlert: null, updatedMinutesAgo: 1, lastError: null } as RailwaySummary;
  it("Railway: factura estimada; pago pendiente avisa en naranja", () => {
    expect(railwayTile(railway)).toEqual({ value: "≈ US$6.10", sub: "Estimado al 5-dic", tone: "muted" });
    expect(railwayTile({ ...railway, billingAlert: "Railway marca un pago pendiente…" })).toMatchObject({ sub: "Pago pendiente: ábrela", tone: "orange" });
    expect(railwayTile({ ...railway, estimatedBillUsd: null })).toMatchObject({ value: "US$2.40", sub: "Uso del periodo" });
  });

  const zernio = { estimatedBillUsd: 1.2, totalUsd: 0.35, sentCount: 9800, billingAlert: null, updatedMinutesAgo: 4, lastError: null } as ZernioSummary;
  it("Zernio: factura estimada y mensajes contra los 10,000 gratis", () => {
    expect(zernioTile(zernio)).toEqual({ value: "≈ US$1.20", sub: "9,800 de 10,000 gratis", tone: "muted" });
    expect(zernioTile({ ...zernio, sentCount: 14236 }).sub).toBe("Pasó los 10,000 mensajes gratis");
  });
});

describe("crédito del plan en la tarjeta chica de IA (27-nov-2026)", () => {
  it("el saldo comprado casi en cero no es alerta si queda crédito del plan; cuenta el disponible", () => {
    const plan = { label: "Plan Max", monthlyUsd: 100, usedUsd: 0.5, leftUsd: 99.5, expiresOn: "2026-12-17", coveredByDay: new Map<string, number>() };
    const conPlan = provider({ monthUsd: 7.5, loadedUsd: 45, spentSinceFirstUsd: 44.85, balanceUsd: 0.15, plan, monthPlanUsd: 0.5 });
    expect(iaTile(ai([conPlan, openai]))).toEqual({ value: "US$13.80", sub: "Saldo más bajo: US$8.90 (OpenAI)", tone: "muted" });
    expect(iaTile(ai([conPlan])).sub).toBe("Saldo más bajo: US$99.65 (Anthropic, con el crédito del plan)");
    expect(iaTile(ai([conPlan])).tone).toBe("muted");
  });
});
