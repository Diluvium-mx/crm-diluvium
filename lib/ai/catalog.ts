import type { CatalogModel, ModelRole } from "./types";

// Defaults de la Fase A (brief): filtro = GPT-5.6 Luna, cerebro = Claude Sonnet 5.
export const DEFAULT_FILTER_MODEL = "gpt-5.6-luna";
export const DEFAULT_BRAIN_MODEL = "claude-sonnet-5";

// Catálogo = fuente ÚNICA de qué modelos existen, cómo se llaman en cada API y
// qué llave necesitan (vía provider). Los model-id se verificaron contra docs
// oficiales / OpenRouter (2026-09). Agregar un modelo = una entrada aquí (y su
// adaptador en lib/ai/providers/ si es un proveedor nuevo). `tier` es
// clasificación editable; no cambia comportamiento.
export const MODEL_CATALOG = [
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "openai",
    providerModelId: "gpt-5.6-luna",
    tier: "economico",
    multimodal: true,
    roles: ["filtro"],
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    providerModelId: "claude-sonnet-5",
    tier: "tope",
    multimodal: true,
    roles: ["cerebro"],
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    provider: "openai",
    providerModelId: "gpt-5.6-terra",
    tier: "balanceado",
    multimodal: true,
    roles: ["cerebro"],
  },
  {
    // Respaldo de Terra (mismo proveedor, nivel superior). Id confirmado con dry-run.
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "openai",
    providerModelId: "gpt-5.6-sol",
    tier: "tope",
    multimodal: true,
    roles: ["cerebro"],
  },
  {
    // Opción TOPE de cerebro (Fase B). Id de API confirmado con dry-run.
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    providerModelId: "claude-opus-5-5",
    tier: "tope",
    multimodal: true,
    roles: ["cerebro"],
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    providerModelId: "claude-haiku-4-5-20251001",
    tier: "economico",
    multimodal: true,
    roles: ["cerebro"],
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    providerModelId: "gemini-3.8-flash",
    tier: "balanceado",
    multimodal: true,
    roles: ["cerebro"],
  },
  {
    id: "grok-4.6",
    label: "Grok 4.6",
    provider: "xai",
    providerModelId: "grok-4.6",
    tier: "tope",
    multimodal: true,
    roles: ["cerebro"],
  },
  {
    id: "qwen-3.7-flash",
    label: "Qwen 3.7 Flash",
    provider: "openrouter",
    providerModelId: "qwen/qwen3.7-flash",
    tier: "economico",
    // Verificado: acepta imagen y video de entrada (modalidades de OpenRouter),
    // no es solo texto.
    multimodal: true,
    roles: ["cerebro"],
  },
] as const satisfies readonly CatalogModel[];

export type CatalogModelId = (typeof MODEL_CATALOG)[number]["id"];

export function getModel(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function modelsForRole(role: ModelRole): readonly CatalogModel[] {
  return MODEL_CATALOG.filter((m) => (m.roles as readonly ModelRole[]).includes(role));
}

export const CATALOG_IDS: readonly string[] = MODEL_CATALOG.map((m) => m.id);
