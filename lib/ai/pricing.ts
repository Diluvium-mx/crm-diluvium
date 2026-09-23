// Precios de los modelos en USD por MILLÓN de tokens y cálculo de cost_usd
// (Fase B, PASO 4). PURO: sin DB. Los defaults viven aquí; cada organización
// los sobrescribe en la tabla ai_model_prices SIN redeploy (el runtime lee la
// fila y cae a estos defaults). `null` = sin precio conocido → cost_usd NULL.
//
// Fuentes:
// - Entrada/salida: tabla verificada por el hub (22-sep-2026).
// - Caché Anthropic: lectura = 10% de la entrada, escritura = 125% (regla del hub).
// - Caché OpenAI: doc oficial https://developers.openai.com/api/docs/pricing
//   (Standard, contexto corto; gpt-5.6-luna 0.20 / cached 0.02 / cache writes 0.25):
//   también 10% lectura y 125% escritura.
// - xAI / Google / OpenRouter: sin fuente verificada de caché → sin descuento
//   (los tokens de caché se cobran como entrada normal).
import type { ModelUsage, ProviderId } from "./types";

export type ModelPrice = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
};

type BasePrice = { input: number; output: number };

// Por id del catálogo (todo modelo del catálogo tiene entrada: número o null).
export const DEFAULT_MODEL_PRICES: Readonly<Record<string, BasePrice | null>> = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-sol": { input: 4, output: 20 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "grok-4.6": { input: 2, output: 6 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "gemini-3.8-flash": null,
  "qwen-3.7-flash": null,
};

// 6 decimales, igual que las columnas numeric(12,6) de ai_model_prices (evita
// ruido de punto flotante: 3 × 0.1 = 0.30000000000000004).
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// Precio de caché derivado del de entrada según el proveedor.
export function cachePriceRule(provider: ProviderId, inputPerMTok: number): { read: number; write: number } {
  if (provider === "anthropic" || provider === "openai") {
    return { read: round6(inputPerMTok * 0.1), write: round6(inputPerMTok * 1.25) };
  }
  return { read: inputPerMTok, write: inputPerMTok };
}

// Sobrescritura por organización (fila de ai_model_prices). Caché null = regla.
export type PriceOverride = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
};

// Precio efectivo: la sobrescritura de la org gana; si no, el default del
// código. null si el modelo no tiene precio conocido.
export function resolveModelPrice(
  modelId: string,
  provider: ProviderId,
  override?: PriceOverride | null,
): ModelPrice | null {
  if (override) {
    const rule = cachePriceRule(provider, override.inputPerMTok);
    return {
      inputPerMTok: override.inputPerMTok,
      outputPerMTok: override.outputPerMTok,
      cacheReadPerMTok: override.cacheReadPerMTok ?? rule.read,
      cacheWritePerMTok: override.cacheWritePerMTok ?? rule.write,
    };
  }
  const base = DEFAULT_MODEL_PRICES[modelId];
  if (!base) return null;
  const rule = cachePriceRule(provider, base.input);
  return {
    inputPerMTok: base.input,
    outputPerMTok: base.output,
    cacheReadPerMTok: rule.read,
    cacheWritePerMTok: rule.write,
  };
}

// Costo en USD de una llamada. `usage.inputTokens` es el TOTAL de entrada e
// INCLUYE los tokens leídos y escritos en caché (AI SDK v7, Anthropic y OpenAI:
// total = sinCaché + cacheRead + cacheWrite); por eso se restan antes de cobrar
// la parte sin caché. null si no hay precio o el proveedor no reportó uso.
export function computeCostUsd(usage: ModelUsage, price: ModelPrice | null): number | null {
  if (!price) return null;
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  const total = usage.inputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const noCache = Math.max(0, total - cacheRead - cacheWrite);
  const output = usage.outputTokens ?? 0;
  const micro =
    noCache * price.inputPerMTok +
    cacheRead * price.cacheReadPerMTok +
    cacheWrite * price.cacheWritePerMTok +
    output * price.outputPerMTok;
  // 8 decimales: suficiente para centavos acumulados de miles de llamadas.
  return Math.round((micro / 1_000_000) * 1e8) / 1e8;
}
