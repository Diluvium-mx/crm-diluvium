import "server-only";
import { DEFAULT_BRAIN_MODEL, modelsForRole } from "@/lib/ai/catalog";
import { DEFAULT_MODEL_PRICES } from "@/lib/ai/pricing";
import { costTier } from "./editor";
import { modelAvailability, PROVIDER_META } from "@/lib/ai/provider";
import type { ModelRole } from "@/lib/ai/types";
import type { ModelOptionView } from "./types";

// Texto para el usuario cuando una opción no está disponible.
function reasonText(reason: string, envKey: string | null): string {
  switch (reason) {
    case "missing_key":
      return `Falta la llave ${envKey ?? "?"} en el entorno`;
    case "no_adapter":
      return "Proveedor aún no disponible (próximo brief)";
    case "unknown_model":
      return "Modelo no reconocido";
    default:
      return "No disponible";
  }
}

// Construye las opciones de un rol (filtro|cerebro) con su disponibilidad,
// leyendo las llaves presentes en el entorno del SERVIDOR. Solo se llama en el
// servidor (lee process.env vía modelAvailability); nunca se importa desde el
// cliente. Las opciones sin llave/adaptador quedan `available: false` → gris.
export function buildModelOptions(role: ModelRole): ModelOptionView[] {
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
      costTier: costTier(DEFAULT_MODEL_PRICES[m.id]?.output ?? null),
      recommended: m.id === DEFAULT_BRAIN_MODEL,
      isNew: m.isNew === true,
    };
  });
}
