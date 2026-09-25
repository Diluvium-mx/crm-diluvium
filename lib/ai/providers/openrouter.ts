import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, isStepCount } from "ai";
import type { ProviderAdapter } from "../provider";
import { DEFAULT_MODEL_TIMEOUT_MS } from "../types";
import { toModelUsage } from "./usage";

// Adaptador OpenRouter (Qwen y otros), Fase E (25-sep-2026). OpenRouter expone
// una API compatible con OpenAI; se usa el paquete OFICIAL del AI SDK
// (@ai-sdk/openai-compatible) apuntando a su URL, sin el SDK de OpenRouter. La
// caché la aplica el proveedor de cada modelo y se reporta como cached_tokens
// (→ inputTokenDetails.cacheReadTokens) — docs: https://openrouter.ai/docs.
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const openrouterAdapter: ProviderAdapter = {
  id: "openrouter",
  async generate(providerModelId, apiKey, input) {
    const openrouter = createOpenAICompatible({ name: "openrouter", baseURL: OPENROUTER_BASE_URL, apiKey });
    const result = await generateText({
      model: openrouter(providerModelId),
      system: input.system,
      messages: input.messages,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      abortSignal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS),
      // Herramientas sin `execute` (Fase D): una sola vuelta.
      ...(input.tools ? { tools: input.tools, stopWhen: isStepCount(1) } : {}),
    });
    return {
      text: result.text,
      usage: toModelUsage(result.usage),
      finishReason: result.finishReason,
      toolCalls: result.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
    };
  },
};
