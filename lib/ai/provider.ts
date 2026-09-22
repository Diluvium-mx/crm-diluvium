import type { CallModelInput, ProviderGenerateOutput, ProviderId } from "./types";
import { getModel } from "./catalog";

export type ProviderMeta = { id: ProviderId; label: string; envKey: string };

// Metadatos de TODOS los proveedores (aunque aún no tengan adaptador): la UI los
// usa para decir qué llave falta y con qué etiqueta mostrar el proveedor.
// `envKey` es la variable de entorno con la llave del proveedor.
export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  openai: { id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY" },
  anthropic: { id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
  google: { id: "google", label: "Google", envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  xai: { id: "xai", label: "xAI", envKey: "XAI_API_KEY" },
  openrouter: { id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
};

// Proveedores con adaptador implementado en la Fase A. MANTENER EN SINCRONÍA con
// ADAPTERS en lib/ai/index.ts (index.ts valida la sincronía al cargar).
export const IMPLEMENTED_PROVIDERS: readonly ProviderId[] = ["openai", "anthropic"];

export function providerImplemented(provider: ProviderId): boolean {
  return IMPLEMENTED_PROVIDERS.includes(provider);
}

// Contrato de un adaptador de proveedor. Cada proveedor mapea la entrada única
// (system + messages + tools) a su SDK, cableando la caché del system a su
// manera (OpenAI automática, Anthropic explícita con cacheControl).
export interface ProviderAdapter {
  readonly id: ProviderId;
  generate(
    providerModelId: string,
    apiKey: string,
    input: CallModelInput,
  ): Promise<ProviderGenerateOutput>;
}

export type ModelAvailability = {
  available: boolean;
  reason: "ok" | "missing_key" | "no_adapter" | "unknown_model";
  envKey: string | null;
};

// ¿Se puede usar este modelo AHORA? Necesita adaptador implementado y su llave
// presente en el entorno. `env` se inyecta para poder testear sin process.env.
// No importa el SDK: es seguro llamarlo desde donde sea (UI server, tests).
export function modelAvailability(
  modelId: string,
  env: Record<string, string | undefined> = process.env,
): ModelAvailability {
  const model = getModel(modelId);
  if (!model) return { available: false, reason: "unknown_model", envKey: null };
  const { envKey } = PROVIDER_META[model.provider];
  if (!providerImplemented(model.provider)) return { available: false, reason: "no_adapter", envKey };
  if (!env[envKey]) return { available: false, reason: "missing_key", envKey };
  return { available: true, reason: "ok", envKey };
}
