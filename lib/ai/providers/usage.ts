import type { ModelUsage } from "../types";

// El objeto `usage` que devuelve generateText (AI SDK v7). Se acepta
// estructuralmente para no depender de que el nombre del tipo esté exportado;
// los campos coinciden con LanguageModelUsage (ai/dist).
type SdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

// Normaliza el uso de tokens del SDK a nuestro ModelUsage (independiente del
// proveedor). La caché se reporta igual para OpenAI y Anthropic en v7:
// usage.inputTokenDetails.cacheReadTokens / cacheWriteTokens.
export function toModelUsage(usage: SdkUsage): ModelUsage {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
  };
}
