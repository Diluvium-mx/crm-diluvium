import { createOpenAI } from "@ai-sdk/openai";
import { generateText, isStepCount } from "ai";
import type { ProviderAdapter } from "../provider";
import { DEFAULT_MODEL_TIMEOUT_MS } from "../types";
import { toModelUsage } from "./usage";

// Adaptador OpenAI. La caché del prompt es AUTOMÁTICA (se activa con prompts de
// ≥1024 tokens, sin configuración) — docs:
// https://ai-sdk.dev/providers/ai-sdk-providers/openai#prompt-caching
// El system va como parámetro top-level; los tokens cacheados se leen del
// `usage` (inputTokenDetails.cacheReadTokens). La llamada va DIRECTO a OpenAI
// con la llave (sin gateway de terceros).
export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  async generate(providerModelId, apiKey, input) {
    const openai = createOpenAI({ apiKey });
    const result = await generateText({
      model: openai(providerModelId),
      system: input.system,
      messages: input.messages,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      abortSignal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS),
      // Tools quedan cableados para la Fase B (multi-paso con stopWhen); el
      // dry-run de la Fase A no los usa.
      ...(input.tools ? { tools: input.tools, stopWhen: isStepCount(4) } : {}),
    });
    return {
      text: result.text,
      usage: toModelUsage(result.usage),
      finishReason: result.finishReason,
    };
  },
};
