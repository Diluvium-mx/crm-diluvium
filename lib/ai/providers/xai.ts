import { createXai } from "@ai-sdk/xai";
import { generateText, isStepCount } from "ai";
import type { ProviderAdapter } from "../provider";
import { DEFAULT_MODEL_TIMEOUT_MS } from "../types";
import { toModelUsage } from "./usage";

// Adaptador xAI (Grok), Fase E (25-sep-2026). La caché del prompt es AUTOMÁTICA
// (se reporta como cached_tokens → inputTokenDetails.cacheReadTokens) — docs:
// https://docs.x.ai/docs/models. La llamada va DIRECTO a xAI con la llave.
export const xaiAdapter: ProviderAdapter = {
  id: "xai",
  async generate(providerModelId, apiKey, input) {
    const xai = createXai({ apiKey });
    const result = await generateText({
      model: xai(providerModelId),
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
