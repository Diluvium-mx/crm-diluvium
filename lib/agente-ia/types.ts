import type { ModelTier, ProviderId } from "@/lib/ai/types";

// Vistas seguras para el cliente (sin imports de servidor ni del SDK). El
// componente cliente de la pestaña "Agente IA" importa solo estos tipos.

// Una opción de modelo para el selector. Incluye disponibilidad para
// deshabilitar (gris) la opción y explicar por qué.
export type ModelOptionView = {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  tier: ModelTier;
  multimodal: boolean;
  available: boolean;
  disabledReason: string | null;
};

export type AiConfigView = {
  modeloFiltro: string;
  modeloCerebro: string;
};

export type DryRunUsageView = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

// Resultado de una etapa del dry-run (filtro o cerebro).
export type DryRunStageView = {
  stage: "filtro" | "cerebro";
  modelId: string;
  label: string;
  ok: boolean;
  text: string | null;
  error: string | null;
  usage: DryRunUsageView | null;
};

export type ProbarModeloResultView = {
  stages: DryRunStageView[];
};
