// Qué modelo atiende una respuesta según la etapa del contacto (Fase E,
// 25-sep-2026). PURO (sin BD). Modelo 1 atiende las etapas elegidas en la pestaña
// Agente IA (default Inbox, Prospecto e Interesado, decisión del dueño); las
// demás, el Modelo 2 (= modelo_cerebro). Sin etapa conocida, el Modelo 2: si hay
// duda, que conteste el más capaz.
import { isStage, STAGES, type Stage } from "@/lib/contacts/stages";

export const DEFAULT_MODEL_1_STAGES: readonly Stage[] = ["inbox", "prospecto", "interesado"];

export type ModelSlot = 1 | 2;

// Solo etapas reales, sin repetir y en el orden del Embudo.
export function normalizeModel1Stages(stages: readonly string[]): Stage[] {
  return STAGES.filter((s) => stages.some((v) => isStage(v) && v === s));
}

export function brainModelForStage(
  cfg: { modelo1: string; modeloCerebro: string; etapasModelo1: readonly string[] },
  stage: string | null,
): { modelId: string; slot: ModelSlot } {
  if (stage !== null && isStage(stage) && normalizeModel1Stages(cfg.etapasModelo1).includes(stage)) {
    return { modelId: cfg.modelo1, slot: 1 };
  }
  return { modelId: cfg.modeloCerebro, slot: 2 };
}

// Como brainModelForStage, pero si el Modelo 1 no se puede usar en este entorno
// (falta su llave o su adaptador) contesta el Modelo 2: el agente nunca se queda
// callado por una llave faltante (revisión de Codex, 25-sep-2026).
export function pickBrainModel(
  cfg: { modelo1: string; modeloCerebro: string; etapasModelo1: readonly string[] },
  stage: string | null,
  isAvailable: (modelId: string) => boolean,
): { modelId: string; slot: ModelSlot; fallback: boolean } {
  const pick = brainModelForStage(cfg, stage);
  if (pick.slot === 1 && !isAvailable(pick.modelId)) return { modelId: cfg.modeloCerebro, slot: 2, fallback: true };
  return { ...pick, fallback: false };
}
