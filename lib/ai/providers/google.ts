import { createGoogle } from "@ai-sdk/google";
import { generateText, isStepCount } from "ai";
import type { ProviderAdapter } from "../provider";
import { DEFAULT_MODEL_TIMEOUT_MS } from "../types";
import { toModelUsage } from "./usage";

// Adaptador Google (Gemini), Fase E (25-sep-2026). La caché del prompt es
// IMPLÍCITA (Gemini la aplica sola a prefijos repetidos; se reporta como
// cachedContentTokenCount → inputTokenDetails.cacheReadTokens) — docs:
// https://ai.google.dev/gemini-api/docs/caching. La llamada va DIRECTO a Google
// con la llave (sin gateway de terceros).
export const googleAdapter: ProviderAdapter = {
  id: "google",
  async generate(providerModelId, apiKey, input) {
    const google = createGoogle({ apiKey });
    const result = await generateText({
      model: google(providerModelId),
      system: input.system,
      messages: input.messages,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      abortSignal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS),
      // Sin reintentos ocultos del SDK (Fase E): el runtime decide (un solo reintento
      // si el proveedor está saturado; si no, tarjeta para el vendedor).
      maxRetries: 0,
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
