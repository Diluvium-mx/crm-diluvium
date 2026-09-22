import type { CallModelInput, CallModelResult, ProviderId } from "./types";
import { getModel } from "./catalog";
import { IMPLEMENTED_PROVIDERS, PROVIDER_META, type ProviderAdapter } from "./provider";
import { openaiAdapter } from "./providers/openai";
import { anthropicAdapter } from "./providers/anthropic";

// Re-exports útiles para consumidores (UI server, worker) sin tener que conocer
// la estructura interna.
export {
  modelAvailability,
  providerImplemented,
  PROVIDER_META,
  IMPLEMENTED_PROVIDERS,
} from "./provider";
export type { ModelAvailability } from "./provider";
export { getModel, modelsForRole, MODEL_CATALOG, DEFAULT_FILTER_MODEL, DEFAULT_BRAIN_MODEL } from "./catalog";
export type { CallModelInput, CallModelResult, CatalogModel, ModelUsage, ProviderId } from "./types";

// Modelo desconocido (no está en el catálogo).
export class ModelNotFoundError extends Error {
  constructor(readonly modelId: string) {
    super(`Modelo desconocido en el catálogo: ${modelId}.`);
    this.name = "ModelNotFoundError";
  }
}

// Proveedor sin adaptador todavía (google/xai/openrouter en la Fase A).
export class ProviderNotImplementedError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly modelId: string,
  ) {
    super(`El proveedor ${provider} aún no tiene adaptador (modelo ${modelId}).`);
    this.name = "ProviderNotImplementedError";
  }
}

// Falta la llave del proveedor en el entorno.
export class ModelNotConfiguredError extends Error {
  constructor(
    readonly envKey: string,
    readonly modelId: string,
  ) {
    super(`Falta la variable de entorno ${envKey} para usar el modelo ${modelId}.`);
    this.name = "ModelNotConfiguredError";
  }
}

const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
};

// Falla al cargar si el registro de adaptadores no coincide con
// IMPLEMENTED_PROVIDERS (evita que se desincronicen sin que nadie lo note).
for (const provider of IMPLEMENTED_PROVIDERS) {
  if (!ADAPTERS[provider]) {
    throw new Error(`Adaptador faltante para el proveedor implementado '${provider}'.`);
  }
}

// Punto ÚNICO de llamada a un modelo, sea el proveedor que sea. Resuelve el
// catálogo, exige la llave, delega en el adaptador del proveedor y normaliza la
// salida. Las llamadas van DIRECTO al proveedor con su llave (sin gateway de
// terceros). Compartido: lo usan el web (dry-run) y el worker (Fase B).
export async function callModel(modelId: string, input: CallModelInput): Promise<CallModelResult> {
  const model = getModel(modelId);
  if (!model) throw new ModelNotFoundError(modelId);

  const adapter = ADAPTERS[model.provider];
  if (!adapter) throw new ProviderNotImplementedError(model.provider, modelId);

  const { envKey } = PROVIDER_META[model.provider];
  const apiKey = process.env[envKey];
  if (!apiKey) throw new ModelNotConfiguredError(envKey, modelId);

  const output = await adapter.generate(model.providerModelId, apiKey, input);
  return {
    modelId: model.id,
    provider: model.provider,
    providerModelId: model.providerModelId,
    ...output,
  };
}
