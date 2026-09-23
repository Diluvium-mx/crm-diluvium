import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount } from "ai";
import type { ProviderAdapter } from "../provider";
import { DEFAULT_MODEL_TIMEOUT_MS } from "../types";
import { toModelUsage } from "./usage";

// Adaptador Anthropic. La caché del prompt es EXPLÍCITA: el system se cachea con
// `cacheControl: { type: 'ephemeral' }` (breakpoint de caché) — docs:
// https://ai-sdk.dev/providers/ai-sdk-providers/anthropic (Cache Control).
// En el AI SDK v7 el system va SIEMPRE en el parámetro top-level `system` (meter
// un mensaje role:"system" en `messages[]` lanza AI_InvalidPromptError). Para
// adjuntarle el cacheControl se pasa como `SystemModelMessage` (objeto), no como
// string. Los tokens de lectura/escritura de caché se leen del `usage`
// (inputTokenDetails.cacheReadTokens / cacheWriteTokens). Con el system de
// prueba (corto) la caché marca 0 hasta que el system real (largo, Fase B)
// supere el mínimo (~1024 tokens); el cableado y el reporte ya están listos.
// La llamada va DIRECTO a Anthropic con la llave (sin gateway de terceros).
export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  async generate(providerModelId, apiKey, input) {
    const anthropic = createAnthropic({ apiKey });
    const result = await generateText({
      model: anthropic(providerModelId),
      system: {
        role: "system",
        content: input.system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      messages: input.messages,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      abortSignal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS),
      ...(input.tools ? { tools: input.tools, stopWhen: isStepCount(4) } : {}),
    });
    return {
      text: result.text,
      usage: toModelUsage(result.usage),
      finishReason: result.finishReason,
    };
  },
};
