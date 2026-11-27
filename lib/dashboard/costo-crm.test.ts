import { describe, expect, it } from "vitest";
import type { AiSpendSummary, ProviderSpend } from "./ai-spend";
import { resumirCostoCrm, type MesGuardado } from "./costo-crm";
import type { MetaWhatsappSummary } from "./meta-whatsapp";
import { summarizeRailway } from "./railway";
import type { ZernioSummary } from "./zernio";

// 20 de noviembre a mediodía UTC: van 19.5 días del mes (30 días).
const NOW = new Date("2026-11-20T12:00:00Z");

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

const spend: AiSpendSummary = {
  monthLabel: "noviembre de 2026",
  providers: [provider({ monthUsd: 15.2 }), provider({ provider: "openai", label: "OpenAI", monthUsd: 6.3 })],
  topups: [],
};
const meta = { monthLabel: "noviembre", totalUsd: 23.6, charged: 412, prevMonthLabel: "octubre", prevTotalUsd: 44.16, updatedMinutesAgo: 30, lastError: null } satisfies MetaWhatsappSummary;
// Periodo de Railway del 5-nov al 5-dic con US$2.40 de uso (Hobby incluye US$5).
const railway = summarizeRailway(
  { plan: "HOBBY", state: "ACTIVE", periodStart: new Date("2026-11-05T23:44:00Z"), periodEnd: new Date("2026-12-05T23:44:00Z"), usageUsd: 2.4, fetchedAt: NOW, lastError: null },
  NOW,
);
const zernio = { totalUsd: 0.35, estimatedBillUsd: 1.2 } as ZernioSummary;
const guardados: MesGuardado[] = [
  { month: "2026-09", iaUsd: 10, metaUsd: 0, railwayUsd: 0, zernioUsd: null },
  { month: "2026-10", iaUsd: 40.5, metaUsd: 44.16, railwayUsd: 12.9, zernioUsd: 1.08 },
];

describe("resumirCostoCrm", () => {
  const base = { now: NOW, spend, iaProyeccionUsd: 33, meta, railway, zernio, guardados };

  it("va = IA + Meta + Railway (nunca menos del plan) + Zernio", () => {
    const c = resumirCostoCrm(base);
    // 21.5 + 23.6 + 5 (plan Hobby: el uso de 2.40 no llega) + 0.35
    expect(c.vaUsd).toBe(50.45);
    expect(c.monthLabel).toBe("noviembre");
    expect(c.sinDato).toEqual([]);
  });

  it("partes de mayor a menor, con su porcentaje", () => {
    const c = resumirCostoCrm(base);
    expect(c.partes.map((p) => p.servicio)).toEqual(["meta", "ia", "railway", "zernio"]);
    expect(Math.round(c.partes[0].pct)).toBe(47);
    expect(c.partes.reduce((s, p) => s + p.pct, 0)).toBeCloseTo(100);
  });

  it("cierre estimado: proyección de IA, Meta al mes completo, facturas estimadas de Railway y Zernio", () => {
    const c = resumirCostoCrm(base);
    const metaCierre = (23.6 / 19.5) * 30;
    expect(c.cierreUsd).toBeCloseTo(33 + metaCierre + (railway.estimatedBillUsd ?? 0) + 1.2, 1);
  });

  it("la proyección de IA nunca baja de lo que ya va", () => {
    const c = resumirCostoCrm({ ...base, iaProyeccionUsd: 3 });
    const sinIa = resumirCostoCrm({ ...base, spend: null });
    expect((c.cierreUsd ?? 0) - (sinIa.cierreUsd ?? 0)).toBeCloseTo(21.5, 2);
  });

  it("el primer día del mes no hay cierre", () => {
    expect(resumirCostoCrm({ ...base, now: new Date("2026-11-01T10:00:00Z") }).cierreUsd).toBeNull();
  });

  it("mes pasado: lo que guardó el worker de ese mes", () => {
    const c = resumirCostoCrm(base);
    expect(c.prevLabel).toBe("octubre");
    expect(c.prevUsd).toBe(98.64);
  });

  it("sin el mes pasado guardado no hay mes pasado (y ya no hay total acumulado)", () => {
    const c = resumirCostoCrm({ ...base, guardados: [] });
    expect(c.prevUsd).toBeNull();
    expect(c).not.toHaveProperty("totalUsd");
  });

  it("modelos de reserva: la compra de crédito del mes suma a la IA (va y cierre); lo que se usa de ellos no", () => {
    const conReserva = { ...spend, providers: [...spend.providers, provider({ provider: "openrouter", label: "OpenRouter", monthUsd: 0.8 })] };
    const compras = [
      { provider: "xai", amountUsd: 5, toppedUpOn: "2026-11-10" },
      // De otro mes: no cuenta.
      { provider: "google", amountUsd: 5.67, toppedUpOn: "2026-09-25" },
    ];
    const c = resumirCostoCrm({ ...base, spend: conReserva, compras });
    expect(c.vaUsd).toBe(55.45);
    expect((c.cierreUsd ?? 0) - (resumirCostoCrm(base).cierreUsd ?? 0)).toBeCloseTo(5, 2);
  });

  it("un servicio sin lectura no suma y se avisa", () => {
    const c = resumirCostoCrm({ ...base, meta: { ...meta, totalUsd: null }, zernio: null });
    expect(c.sinDato).toEqual(["WhatsApp (Meta)", "Zernio"]);
    expect(c.vaUsd).toBe(26.5);
  });
});
