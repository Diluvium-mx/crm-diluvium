import "server-only";
import { DEFAULT_BRAIN_MODEL, modelsForRole } from "@/lib/ai/catalog";
import { resolveModelPrice, type PriceOverride } from "@/lib/ai/pricing";
import { modelAvailability, PROVIDER_META, providerImplemented } from "@/lib/ai/provider";
import type { ModelRole } from "@/lib/ai/types";
import { costPer100Conversations, FIXED_PROFILE, type UsageProfile } from "./model-cost";
import type { ModelOptionView, ProviderApiView } from "./types";

// Texto para el usuario cuando una opción no está disponible (mismo lenguaje que
// el panel "APIs de IA").
function reasonText(reason: string, envKey: string | null): string {
  switch (reason) {
    case "missing_key":
      return `Falta la llave ${envKey ?? "?"} en Railway`;
    case "no_adapter":
      return "Falta soporte en el CRM";
    case "unknown_model":
      return "Modelo no reconocido";
    default:
      return "No disponible";
  }
}

// Con qué se estima el costo de cada opción: perfil de uso y precios
// sobrescritos por la organización (lib/agente-ia/model-cost-store.ts).
export type ModelCostInputs = { profile: UsageProfile; overrides: Readonly<Record<string, PriceOverride>> };

// Construye las opciones de un rol (filtro|cerebro) con su disponibilidad,
// leyendo las llaves presentes en el entorno del SERVIDOR. Solo se llama en el
// servidor (lee process.env vía modelAvailability); nunca se importa desde el
// cliente. Las opciones sin llave/adaptador quedan `available: false` → gris.
// `recommendedId`: la etiqueta "Recomendado" (Modelo 1 → Luna, Modelo 2 → Sonnet 5).
export function buildModelOptions(
  role: ModelRole,
  cost: ModelCostInputs = { profile: FIXED_PROFILE, overrides: {} },
  recommendedId: string = DEFAULT_BRAIN_MODEL,
): ModelOptionView[] {
  return modelsForRole(role).map((m) => {
    const availability = modelAvailability(m.id);
    return {
      id: m.id,
      label: m.label,
      provider: m.provider,
      providerLabel: PROVIDER_META[m.provider].label,
      tier: m.tier,
      multimodal: m.multimodal,
      available: availability.available,
      disabledReason: availability.available ? null : reasonText(availability.reason, availability.envKey),
      costPer100Usd: costPer100Conversations(cost.profile, resolveModelPrice(m.id, m.provider, cost.overrides[m.id] ?? null)),
      recommended: m.id === recommendedId,
      isNew: m.isNew === true,
    };
  });
}

// Panel "APIs de IA": por proveedor, si el CRM tiene su adaptador y si la variable
// de su llave EXISTE en el entorno del servidor. Nunca lee ni devuelve el valor de
// la llave: solo si hay algo. Mismo orden y criterio que modelAvailability.
export function buildApiProviders(env: Record<string, string | undefined> = process.env): ProviderApiView[] {
  return Object.values(PROVIDER_META).map((p) => ({
    id: p.id,
    label: p.label,
    envKey: p.envKey,
    state: !providerImplemented(p.id) ? "falta_soporte" : env[p.envKey] ? "conectada" : "falta_llave",
  }));
}
