import type { ModelTier, ProviderId } from "@/lib/ai/types";
import type { AgentModeValue, AgentSettings } from "./settings";

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

// ── Fase B: ajustes del runtime (pestaña Agente IA) ──────────────────────────

export type ChannelAgentView = {
  id: string;
  displayName: string;
  phoneE164: string | null;
  isActive: boolean;
  mode: AgentModeValue;
};

export type ModelPriceView = {
  modelId: string;
  label: string;
  providerLabel: string;
  // Default del código (null = sin precio conocido).
  defaultInput: number | null;
  defaultOutput: number | null;
  // Sobrescritura de la organización (null = usa el default).
  overrideInput: number | null;
  overrideOutput: number | null;
  cacheNote: string;
};

export type KnowledgeStatusView = { goalChars: number; faqsEnabled: number };

export type AgentSettingsBundleView = {
  settings: AgentSettings;
  channels: ChannelAgentView[];
  prices: ModelPriceView[];
  knowledge: KnowledgeStatusView;
};

// ── Fase B: el agente en una conversación (Bandeja y panel del contacto) ─────
export type AgentStateValue = "activo" | "pausado_humano" | "pausado_handover" | "pausado_antibucle";

export type AgentDraftView = { id: string; bubbles: string[]; createdAt: string };

export type AgentThreadView = {
  channelMode: AgentModeValue;
  agentState: AgentStateValue;
  /** ISO; solo en "pasado a humano" (reactivación automática). */
  pausedUntil: string | null;
  draft: AgentDraftView | null;
};

export type ContactAgentView = {
  conversationId: string;
  channelName: string;
  channelMode: AgentModeValue;
  agentState: AgentStateValue;
  pausedUntil: string | null;
};

export type AgentActionResult = { ok: true } | { ok: false; message: string };
