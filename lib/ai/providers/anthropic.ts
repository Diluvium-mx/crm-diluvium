import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount } from "ai";
import type { ProviderAdapter } from "../provider";
import { DEFAULT_MODEL_TIMEOUT_MS } from "../types";
import { ANTHROPIC_CACHE_CONTROL, withHistoryCacheBreakpoint } from "./anthropic-cache";
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
        providerOptions: { anthropic: { cacheControl: ANTHROPIC_CACHE_CONTROL } },
      },
      // Fase E: el historial también se cachea (anthropic-cache.ts). Ambas marcas, de 1 h.
      messages: withHistoryCacheBreakpoint(input.messages),
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      abortSignal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS),
      // Sin reintentos ocultos del SDK (Fase E): el runtime decide (un solo reintento
      // si el proveedor está saturado; si no, tarjeta para el vendedor).
      maxRetries: 0,
      // Herramientas sin `execute` (Fase D): una sola vuelta; el modelo devuelve
      // texto + llamadas y el runtime decide qué corre (nada se ejecuta aquí).
      ...(input.tools ? { tools: input.tools, stopWhen: isStepCount(1) } : {}),
    });
    return {
      text: result.text,
      // La escritura de 1 h cuesta 2× la entrada (la de 5 min, 1.25×): se separa con el
      // desglose que trae el uso crudo de Anthropic (usage.cache_creation).
      usage: { ...toModelUsage(result.usage), cacheWrite1hTokens: cacheWrite1hTokens(result.providerMetadata) },
      finishReason: result.finishReason,
      toolCalls: result.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
    };
  },
};

// Tokens escritos en la caché de 1 h, del uso crudo de Anthropic
// (usage.cache_creation.ephemeral_1h_input_tokens). null si no vino el desglose.
export function cacheWrite1hTokens(providerMetadata: unknown): number | null {
  const usage = (providerMetadata as { anthropic?: { usage?: { cache_creation?: { ephemeral_1h_input_tokens?: unknown } } } } | undefined)
    ?.anthropic?.usage;
  const n = usage?.cache_creation?.ephemeral_1h_input_tokens;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
