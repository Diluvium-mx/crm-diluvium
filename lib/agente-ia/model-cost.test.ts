import { describe, expect, it } from "vitest";
import { resolveModelPrice } from "@/lib/ai/pricing";
import {
  costPer100Conversations,
  costPer100Label,
  FIXED_PROFILE,
  MIN_REAL_RESPONSES,
  usageProfile,
  type UsageTotals,
} from "./model-cost";

const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  responses: 40,
  conversations: 10,
  inputTokens: 40 * 10_000,
  cacheReadTokens: 40 * 8_000,
  cacheWriteTokens: 40 * 500,
  outputTokens: 40 * 200,
  ...over,
});

describe("usageProfile", () => {
  it("con 20 o más respuestas: promedios reales por respuesta y respuestas por conversación", () => {
    const { profile, basis } = usageProfile(totals());
    expect(basis).toEqual({ source: "real", responses: 40 });
    expect(profile).toEqual({
      inputTokens: 10_000,
      cacheReadTokens: 8_000,
      cacheWriteTokens: 500,
      outputTokens: 200,
      responsesPerConversation: 4,
    });
  });

  it("con menos de 20 respuestas: perfil fijo", () => {
    const { profile, basis } = usageProfile(totals({ responses: MIN_REAL_RESPONSES - 1 }));
    expect(profile).toBe(FIXED_PROFILE);
    expect(basis).toEqual({ source: "fijo", responses: 19 });
  });

  it("sin conversaciones (datos raros): perfil fijo, sin dividir entre cero", () => {
    expect(usageProfile(totals({ conversations: 0 })).basis.source).toBe("fijo");
  });
});

describe("costPer100Conversations", () => {
  it("multiplica el costo de una respuesta promedio por respuestas/conversación × 100", () => {
    const profile = { inputTokens: 10_000, cacheReadTokens: 8_000, cacheWriteTokens: 500, outputTokens: 200, responsesPerConversation: 4 };
    // Claude Sonnet 5: entrada 2, salida 10, caché lectura 0.2, escritura 2.5 (USD/MTok).
    // Por respuesta: 1,500×2 + 8,000×0.2 + 500×2.5 + 200×10 = 7,850 µUSD = 0.00785.
    const usd = costPer100Conversations(profile, resolveModelPrice("claude-sonnet-5", "anthropic"));
    expect(usd).toBeCloseTo(0.00785 * 4 * 100, 10);
  });

  it("modelo sin precio: null", () => {
    expect(costPer100Conversations(FIXED_PROFILE, resolveModelPrice("gemini-3.8-flash", "google"))).toBeNull();
  });

  it("la sobrescritura de precio de la organización cuenta", () => {
    const base = costPer100Conversations(FIXED_PROFILE, resolveModelPrice("claude-sonnet-5", "anthropic"));
    const cheaper = costPer100Conversations(
      FIXED_PROFILE,
      resolveModelPrice("claude-sonnet-5", "anthropic", { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: null, cacheWritePerMTok: null }),
    );
    expect(cheaper).not.toBeNull();
    expect(cheaper!).toBeCloseTo(base! / 2, 10);
  });
});

describe("costPer100Label", () => {
  it("texto corto del selector", () => {
    expect(costPer100Label(1.6)).toBe("≈ US$1.60 por cada 100 conversaciones");
    expect(costPer100Label(0.001)).toBe("≈ menos de US$0.01 por cada 100 conversaciones");
    expect(costPer100Label(null)).toBe("costo sin dato");
  });
});
