import type { ModelMessage, ToolSet } from "ai";

// Identidad de proveedor. openai/anthropic tienen adaptador en la Fase A;
// google/xai/openrouter se agregan después (un archivo adaptador por proveedor,
// sin tocar el resto).
export type ProviderId = "openai" | "anthropic" | "google" | "xai" | "openrouter";

// Nivel: para que el admin elija con criterio de costo/capacidad. No cambia
// comportamiento; es metadato para la UI.
export type ModelTier = "tope" | "balanceado" | "economico";

// Para qué sirve el modelo en el pipeline del agente.
export type ModelRole = "filtro" | "cerebro";

// Una entrada del catálogo (lib/ai/catalog.ts). `id` es estable e interno (lo
// que se guarda en ai_config); `providerModelId` es el string exacto que se le
// pasa al SDK del proveedor.
export type CatalogModel = {
  id: string;
  label: string;
  provider: ProviderId;
  providerModelId: string;
  tier: ModelTier;
  multimodal: boolean;
  roles: readonly ModelRole[];
};

// Uso de tokens normalizado (independiente del proveedor). null = el proveedor
// no lo reportó.
export type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

// Entrada ÚNICA de callModel. `system` va aparte (se cachea según el proveedor);
// `messages` son los turnos user/assistant/tool en el formato del AI SDK (para
// que la Fase B pase imágenes y resultados de herramientas sin rehacer esto).
// `tools` queda cableado para la Fase B; el dry-run de la Fase A no lo usa.
export type CallModelInput = {
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  maxOutputTokens?: number;
  // Tope de espera de la llamada (ms); por defecto DEFAULT_MODEL_TIMEOUT_MS. Un
  // proveedor colgado no debe retener al worker ni la pantalla de prueba.
  timeoutMs?: number;
};

export const DEFAULT_MODEL_TIMEOUT_MS = 90_000;

export type CallModelResult = {
  modelId: string;
  provider: ProviderId;
  providerModelId: string;
  text: string;
  usage: ModelUsage;
  finishReason: string;
};

// Lo que devuelve el adaptador de un proveedor; callModel completa el resto.
export type ProviderGenerateOutput = {
  text: string;
  usage: ModelUsage;
  finishReason: string;
};
