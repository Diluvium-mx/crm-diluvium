import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, type ModelMessage } from "ai";
import type { ProviderAdapter } from "../provider";
import { toModelUsage } from "./usage";

// Adaptador Anthropic. La caché del prompt es EXPLÍCITA: el system se manda como
// bloque de sistema con `cacheControl: { type: 'ephemeral' }` (breakpoint de
// caché) — docs: https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
// (Cache Control). Los tokens de lectura/escritura de caché se leen del `usage`
// (inputTokenDetails.cacheReadTokens / cacheWriteTokens). Con el system de
// prueba (corto) la caché mostrará 0 hasta que el system real (largo, Fase B)
// supere el mínimo (~1024 tokens); el cableado y el reporte ya están listos.
// La llamada va DIRECTO a Anthropic con la llave (sin gateway de terceros).
export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  async generate(providerModelId, apiKey, input) {
    const anthropic = createAnthropic({ apiKey });
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: input.system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      ...input.messages,
    ];
    const result = await generateText({
      model: anthropic(providerModelId),
      messages,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      ...(input.tools ? { tools: input.tools, stopWhen: isStepCount(4) } : {}),
    });
    return {
      text: result.text,
      usage: toModelUsage(result.usage),
      finishReason: result.finishReason,
    };
  },
};
