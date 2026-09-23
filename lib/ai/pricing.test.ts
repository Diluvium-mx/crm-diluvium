import { describe, expect, it } from "vitest";
import { cachePriceRule, computeCostUsd, DEFAULT_MODEL_PRICES, resolveModelPrice } from "./pricing";
import { MODEL_CATALOG } from "./catalog";

describe("resolveModelPrice", () => {
  it("Anthropic: caché lectura 10% y escritura 125% de la entrada", () => {
    expect(resolveModelPrice("claude-sonnet-5", "anthropic")).toEqual({
      inputPerMTok: 2,
      outputPerMTok: 10,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 2.5,
    });
  });

  it("OpenAI: coincide con la doc oficial (luna 0.20 / cached 0.02 / cache writes 0.25 / 1.20)", () => {
    const p = resolveModelPrice("gpt-5.6-luna", "openai")!;
    expect(p.inputPerMTok).toBe(0.2);
    expect(p.cacheReadPerMTok).toBeCloseTo(0.02, 10);
    expect(p.cacheWritePerMTok).toBeCloseTo(0.25, 10);
    expect(p.outputPerMTok).toBe(1.2);
  });

  it("proveedor sin fuente de caché (xAI): sin descuento", () => {
    expect(cachePriceRule("xai", 2)).toEqual({ read: 2, write: 2 });
  });

  it("Gemini 3.8 Flash y Qwen 3.7 Flash: sin precio → null", () => {
    expect(resolveModelPrice("gemini-3.8-flash", "google")).toBeNull();
    expect(resolveModelPrice("qwen-3.7-flash", "openrouter")).toBeNull();
  });

  it("la sobrescritura de la org gana; su caché null usa la regla del proveedor", () => {
    expect(
      resolveModelPrice("claude-sonnet-5", "anthropic", {
        inputPerMTok: 3,
        outputPerMTok: 15,
        cacheReadPerMTok: null,
        cacheWritePerMTok: 4,
      }),
    ).toEqual({ inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 4 });
  });

  it("una sobrescritura da precio incluso a un modelo sin default", () => {
    expect(
      resolveModelPrice("gemini-3.8-flash", "google", {
        inputPerMTok: 0.3,
        outputPerMTok: 2.5,
        cacheReadPerMTok: null,
        cacheWritePerMTok: null,
      })?.inputPerMTok,
    ).toBe(0.3);
  });

  it("todo modelo del catálogo tiene entrada de precio (número o null explícito)", () => {
    for (const m of MODEL_CATALOG) expect(m.id in DEFAULT_MODEL_PRICES).toBe(true);
  });
});

describe("computeCostUsd", () => {
  const sonnet = resolveModelPrice("claude-sonnet-5", "anthropic");

  it("sin caché: entrada × precio + salida × precio", () => {
    // 1,000 in × $2/M + 500 out × $10/M = 0.002 + 0.005
    expect(
      computeCostUsd({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, sonnet),
    ).toBeCloseTo(0.007, 10);
  });

  it("el total de entrada INCLUYE la caché: no se cobra doble", () => {
    // total 11,408 = 8 sin caché + 11,400 leídos de caché. 50 de salida.
    const cost = computeCostUsd(
      { inputTokens: 11_408, outputTokens: 50, cacheReadTokens: 11_400, cacheWriteTokens: 0 },
      sonnet,
    );
    // 8×2 + 11,400×0.2 + 50×10 = 16 + 2,280 + 500 = 2,796 µ$ → 0.002796
    expect(cost).toBeCloseTo(0.002796, 10);
  });

  it("escritura de caché a 125%", () => {
    // 11,400 escritos + 8 sin caché, 0 salida: 11,400×2.5 + 8×2 = 28,516 µ$
    expect(
      computeCostUsd({ inputTokens: 11_408, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 11_400 }, sonnet),
    ).toBeCloseTo(0.028516, 10);
  });

  it("sin precio o sin uso reportado → null", () => {
    expect(computeCostUsd({ inputTokens: 10, outputTokens: 10, cacheReadTokens: null, cacheWriteTokens: null }, null)).toBeNull();
    expect(
      computeCostUsd({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }, sonnet),
    ).toBeNull();
  });

  it("nulos de caché cuentan como 0", () => {
    expect(
      computeCostUsd({ inputTokens: 1000, outputTokens: 0, cacheReadTokens: null, cacheWriteTokens: null }, sonnet),
    ).toBeCloseTo(0.002, 10);
  });
});
