import type { ModelTier, ProviderId } from "@/lib/ai/types";
import type { AgentModeValue } from "./settings";

// Vistas seguras para el cliente (sin imports de servidor ni del SDK). El
// componente cliente de la pestaña "Agente IA" importa solo estos tipos.

// Una opción de modelo para el selector. Incluye disponibilidad para
// deshabilitar (gris) la opción y explicar por qué, el indicador de costo ($ a
// $$$$) y las etiquetas "Recomendado" y "Nuevo".
export type ModelOptionView = {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  tier: ModelTier;
  multimodal: boolean;
  available: boolean;
  disabledReason: string | null;
  costTier: 1 | 2 | 3 | 4 | null;
  recommended: boolean;
  isNew: boolean;
};

// ── Fase B: ajustes del runtime (pestaña Agente IA) ──────────────────────────

export type ChannelAgentView = {
  id: string;
  displayName: string;
  phoneE164: string | null;
  isActive: boolean;
  mode: AgentModeValue;
};

// ── Editor del agente (pestaña "Agente IA" estilo GHL) ───────────────────────
export type FaqView = { id: string; question: string; answer: string; enabled: boolean; position: number };
export type VersionView = { id: string; createdAt: string; author: string | null; summary: string };

export type AgentEditorView = {
  agentName: string;
  companyName: string;
  modeloCerebro: string;
  goal: string;
  faqs: FaqView[];
  goalVersions: VersionView[];
  faqVersions: VersionView[];
  brainOptions: ModelOptionView[];
  channels: ChannelAgentView[];
};

// ── Fase B: el agente en una conversación (Bandeja y panel del contacto) ─────
export type AgentStateValue = "activo" | "pausado_humano" | "pausado_handover" | "pausado_antibucle";

// Aviso del agente para el vendedor, dentro del hilo (discreto, sin acción).
export type AgentNoticeView = {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
};

export type AgentThreadView = {
  channelMode: AgentModeValue;
  agentState: AgentStateValue;
  /** ISO; histórico (ya ninguna pausa vence sola). */
  pausedUntil: string | null;
  notices: AgentNoticeView[];
};

export type ContactAgentView = {
  conversationId: string;
  channelName: string;
  channelMode: AgentModeValue;
  agentState: AgentStateValue;
  pausedUntil: string | null;
};

export type AgentActionResult = { ok: true } | { ok: false; message: string };
