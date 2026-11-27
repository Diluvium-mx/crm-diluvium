import { describe, expect, it } from "vitest";
import type { AiSpendSummary, ProviderSpend } from "@/lib/dashboard/ai-spend";
import type { MetaWhatsappSummary } from "@/lib/dashboard/meta-whatsapp";
import { summarizeRailway } from "@/lib/dashboard/railway";
import type { ZernioSummary } from "@/lib/dashboard/zernio";
import { renglonesMesCerrado, renglonesMesEnCurso } from "./historial";
import { mesDe } from "./mes";

const OCT = { month: "2026-10", iaUsd: 41.02, metaUsd: 44.16, railwayUsd: 13.74, zernioUsd: 1.05 };
const iaOct = [
  { servicio: "IA · Anthropic", paraQue: "Agente IA (Sonnet)", usd: 28.09, nota: null },
  { servicio: "IA · OpenAI", paraQue: "Agente IA (Luna) y audios", usd: 12.93, nota: null },
];

describe("renglonesMesCerrado", () => {
  it("IA por proveedor cuando suma lo mismo que lo guardado; lo demás de lo guardado", () => {
    const r = renglonesMesCerrado(OCT, iaOct);
    expect(r.ia.map((x) => x.usd)).toEqual([28.09, 12.93]);
    expect(r.railway).toMatchObject({ servicio: "Railway", usd: 13.74 });
    expect(r.zernio).toMatchObject({ servicio: "Zernio", usd: 1.05 });
    expect(r.meta).toMatchObject({ servicio: "Meta (WhatsApp)", usd: 44.16, nota: "lo que cobró Meta, sin IVA" });
  });
  it("si la IA por proveedor no cuadra con lo guardado, un solo renglón con lo guardado", () => {
    const r = renglonesMesCerrado({ ...OCT, iaUsd: 40 }, iaOct);
    expect(r.ia).toEqual([{ servicio: "IA", paraQue: "Agente IA y audios", usd: 40, nota: "total guardado del mes" }]);
  });
  it("septiembre con la compra de los modelos de reserva: cuadra con lo guardado y sale por proveedor", () => {
    const iaSep = [
      { servicio: "IA · Anthropic", paraQue: "Agente IA (Sonnet)", usd: 9.18, nota: null },
      { servicio: "IA · OpenAI", paraQue: "Agente IA (Luna) y audios", usd: 0.85, nota: null },
      { servicio: "IA · (xAI, OpenRouter y Google)", paraQue: "Por si fallan Sonnet o Luna", usd: 15.67, nota: "créditos comprados el 25-sep; casi sin uso" },
    ];
    const r = renglonesMesCerrado({ month: "2026-09", iaUsd: 25.7, metaUsd: 0, railwayUsd: 0, zernioUsd: 0 }, iaSep);
    expect(r.ia.map((x) => x.usd)).toEqual([9.18, 0.85, 15.67]);
  });
  it("cero = «sin cobro ese mes»; null = «sin dato»", () => {
    const r = renglonesMesCerrado({ month: "2026-09", iaUsd: 10.03, metaUsd: 0, railwayUsd: 0, zernioUsd: null }, []);
    expect(r.railway).toMatchObject({ usd: 0, nota: "sin cobro ese mes" });
    expect(r.meta).toMatchObject({ usd: 0, nota: "sin cobro ese mes" });
    expect(r.zernio).toMatchObject({ usd: null, nota: "sin dato de ese mes" });
  });
});

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
    ...p,
  };
}

describe("renglonesMesEnCurso", () => {
  const NOW = new Date("2026-11-20T12:00:00Z");
  const spend: AiSpendSummary = {
    monthLabel: "noviembre de 2026",
    providers: [
      provider({ monthUsd: 15.2 }),
      provider({ provider: "openai", label: "OpenAI", monthUsd: 6.3 }),
      provider({ provider: "xai", label: "xAI", monthUsd: 0 }),
    ],
    topups: [],
  };
  const railway = summarizeRailway(
    { plan: "HOBBY", state: "ACTIVE", periodStart: new Date("2026-11-05T23:44:00Z"), periodEnd: new Date("2026-12-05T23:44:00Z"), usageUsd: 2.4, fetchedAt: NOW, lastError: null },
    NOW,
  );
  const zernio = { totalUsd: 0.27, estimatedBillUsd: 1.2 } as ZernioSummary;
  const meta = { monthLabel: "noviembre", totalUsd: 4.34, charged: 127, prevMonthLabel: "octubre", prevTotalUsd: 44.09, updatedMinutesAgo: 30, lastError: null } satisfies MetaWhatsappSummary;

  const NOV = mesDe("2026-11");

  it("lo que va de cada servicio (Railway nunca menos del plan); la IA sin proveedores en cero y la reserva por compras", () => {
    const r = renglonesMesEnCurso({ spend, railway, zernio, meta, compras: [], mes: NOV });
    expect(r.ia.map((x) => [x.servicio, x.usd])).toEqual([
      ["IA · Anthropic", 15.2],
      ["IA · OpenAI", 6.3],
      ["IA · (xAI, OpenRouter y Google)", 0],
    ]);
    expect(r.railway.usd).toBe(5);
    expect(r.railway.nota).toMatch(/^periodo 5-nov → 5-dic; va \(estimado al corte ≈ US\$/);
    expect(r.zernio).toMatchObject({ usd: 0.27, nota: "va (estimado del mes ≈ US$1.20)" });
    expect(r.meta).toMatchObject({ usd: 4.34 });
  });
  it("sin lectura de un servicio: sin dato (no cuenta como cero)", () => {
    const r = renglonesMesEnCurso({ spend: null, railway: null, zernio: null, meta: null, compras: [], mes: NOV });
    expect(r.ia).toEqual([{ servicio: "IA · (xAI, OpenRouter y Google)", paraQue: "Por si fallan Sonnet o Luna", usd: 0, nota: "sin compras ese mes" }]);
    expect([r.railway.usd, r.zernio.usd, r.meta.usd]).toEqual([null, null, null]);
  });
  it("una compra de crédito de reserva en el mes suma aunque se haya usado poco; lo usado no suma", () => {
    const conUso = { ...spend, providers: [...spend.providers.slice(0, 2), provider({ provider: "xai", label: "xAI", monthUsd: 0.4 })] };
    const r = renglonesMesEnCurso({ spend: conUso, railway, zernio, meta, compras: [{ provider: "xai", amountUsd: 5, toppedUpOn: "2026-11-10" }], mes: NOV });
    expect(r.ia.map((x) => [x.servicio, x.usd, x.nota])).toEqual([
      ["IA · Anthropic", 15.2, null],
      ["IA · OpenAI", 6.3, null],
      ["IA · (xAI, OpenRouter y Google)", 5, "créditos comprados el 10-nov; casi sin uso"],
    ]);
  });
});
