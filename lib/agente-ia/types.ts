import type { ModelLogo, ModelTier, ProviderId } from "@/lib/ai/types";
import type { FunnelStage } from "@/lib/contacts/stages";
import type { CostBasis } from "./model-cost";
import type { BotOptions } from "./opciones";
import type { AgentModeValue } from "./settings";

// Vistas seguras para el cliente (sin imports de servidor ni del SDK). El
// componente cliente de la pestaña "Agente IA" importa solo estos tipos.

// Una opción de modelo para el selector. Incluye disponibilidad para
// deshabilitar (gris) la opción y explicar por qué, el costo aproximado por cada
// 100 conversaciones y las etiquetas "Recomendado" y "Nuevo".
export type ModelOptionView = {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  // Logo de la marca a la derecha de la tarjeta (lib/ai/logos.ts); `logoMono` =
  // negro de un color, se invierte en modo oscuro. `logo` = la marca (su movimiento al
  // pasar el mouse sale de lib/ai/logo-motions.ts).
  logo: ModelLogo;
  logoSrc: string;
  logoMono: boolean;
  tier: ModelTier;
  multimodal: boolean;
  available: boolean;
  disabledReason: string | null;
  // USD aproximados por cada 100 conversaciones (lib/agente-ia/model-cost.ts);
  // null = modelo sin precio.
  costPer100Usd: number | null;
  recommended: boolean;
  isNew: boolean;
};

// Estado de la API de un proveedor para el panel "APIs de IA" (todos los roles).
// Solo dice si la variable de la llave EXISTE; nunca lleva su valor.
export type ProviderApiState = "conectada" | "falta_llave" | "falta_soporte";
export type ProviderApiView = { id: ProviderId; label: string; envKey: string; state: ProviderApiState };

// ── Fase B: ajustes del runtime (pestaña Agente IA) ──────────────────────────

export type ChannelAgentView = {
  id: string;
  displayName: string;
  /** Red del canal: WhatsApp (con número) o Instagram (sin número). */
  type: "whatsapp" | "instagram";
  phoneE164: string | null;
  isActive: boolean;
  mode: AgentModeValue;
};

// ── Editor del agente (pestaña "Agente IA" estilo GHL) ───────────────────────
export type FaqView = { id: string; question: string; answer: string; enabled: boolean; position: number };
// `name`: el que le puso el equipo con el lápiz ✎ (null = sin nombre, se ve solo la fecha).
export type VersionView = { id: string; createdAt: string; author: string | null; summary: string; name: string | null };

export type AgentEditorView = {
  agentName: string;
  companyName: string;
  // Fase E: Modelo 2 = modeloCerebro (brainOptions); Modelo 1 = modelo1. Qué modelo
  // atiende cada etapa vive en `stages[].modelSlot` (Columnas del Embudo).
  modeloCerebro: string;
  modelo1: string;
  stages: FunnelStage[];
  goal: string;
  faqs: FaqView[];
  goalVersions: VersionView[];
  faqVersions: VersionView[];
  brainOptions: ModelOptionView[];
  model1Options: ModelOptionView[];
  // De dónde sale el costo aproximado: uso real de 30 días o perfil fijo.
  costBasis: CostBasis;
  apiProviders: ProviderApiView[];
  channels: ChannelAgentView[];
  // Opciones del bot (26-sep-2026) y su último cambio (quién y cuándo, ISO).
  options: BotOptions;
  optionsLastChange: OptionsChangeView | null;
};

export type OptionsChangeView = { field: keyof BotOptions; oldValue: string | null; newValue: string | null; author: string | null; createdAt: string };
export type OptionsActionResult = { ok: true; options: BotOptions; lastChange: OptionsChangeView | null } | { ok: false; message: string };

// ── Fase B: el agente en una conversación (Bandeja y panel del contacto) ─────
export type AgentStateValue = "activo" | "pausado_humano" | "pausado_handover" | "pausado_antibucle";

// Aviso del agente para el vendedor, dentro del hilo (discreto, sin acción).
export type AgentNoticeView = {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
  // Fase E (tarjeta "agente_error"): ISO de cuándo la atendió un vendedor y con qué
  // botón ("reintentar" | "apagar"); null = sin atender.
  resolvedAt: string | null;
  resolution: string | null;
};

export type AgentThreadView = {
  channelMode: AgentModeValue;
  agentState: AgentStateValue;
  /** ISO; hora de regreso del bot ("Apagar bot"); null = hasta "Reactivar". */
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
