// Qué modelo atiende una respuesta según la etapa del contacto (Fase E,
// 25-sep-2026). PURO (sin BD). Modelo 1 atiende las etapas elegidas en la pestaña
// Agente IA (default Inbox, Prospecto e Interesado, decisión del dueño); las
// demás, el Modelo 2 (= modelo_cerebro). Sin etapa conocida, el Modelo 2: si hay
// duda, que conteste el más capaz.
//
// 27-sep-2026 (decisión del dueño): el Modelo 1 califica y, en cuanto decide que el
// contacto pasa a una etapa del Modelo 2 (p. ej. Cerca de compra, aunque se salte
// etapas), esa MISMA respuesta la escribe el Modelo 2 (traspaso). Y si un modelo falla,
// contesta el otro; la tarjeta "El agente no pudo responder" sale solo si fallan los dos.
import { isForward, isStage, STAGES, type Stage } from "@/lib/contacts/stages";
import { SLUG_DATOS_BANCARIOS } from "@/lib/workflows/defaults";

export const DEFAULT_MODEL_1_STAGES: readonly Stage[] = ["inbox", "prospecto", "interesado"];

export type ModelSlot = 1 | 2;

type ModelConfig = { modelo1: string; modeloCerebro: string; etapasModelo1: readonly string[] };

// Solo etapas reales, sin repetir y en el orden del Embudo.
export function normalizeModel1Stages(stages: readonly string[]): Stage[] {
  return STAGES.filter((s) => stages.some((v) => isStage(v) && v === s));
}

export function brainModelForStage(cfg: ModelConfig, stage: string | null): { modelId: string; slot: ModelSlot } {
  if (stage !== null && isStage(stage) && normalizeModel1Stages(cfg.etapasModelo1).includes(stage)) {
    return { modelId: cfg.modelo1, slot: 1 };
  }
  return { modelId: cfg.modeloCerebro, slot: 2 };
}

export type BrainCandidate = { modelId: string; slot: ModelSlot };

// En qué orden se intentan los modelos para UNA respuesta: primero el de la etapa y, si
// falla (error del proveedor o respuesta vacía), el del otro espacio. Uno sin llave o sin
// adaptador en este entorno se salta (el agente nunca se queda callado por una llave
// faltante); el mismo modelo en los dos espacios cuenta una vez. Si ninguno se puede usar
// queda el de la etapa: su falla ("falta la llave") llega a la tarjeta con el motivo claro.
export function brainCandidates(cfg: ModelConfig, stage: string | null, isAvailable: (modelId: string) => boolean): BrainCandidate[] {
  const first = brainModelForStage(cfg, stage);
  const other: BrainCandidate = first.slot === 1 ? { modelId: cfg.modeloCerebro, slot: 2 } : { modelId: cfg.modelo1, slot: 1 };
  const out: BrainCandidate[] = [];
  for (const c of [first, other]) {
    if (isAvailable(c.modelId) && !out.some((o) => o.modelId === c.modelId)) out.push(c);
  }
  return out.length ? out : [first];
}

// Lo que el modelo pidió en su respuesta, en lo que toca a la etapa.
export type StageSignal = { kind: "etapa"; etapa: Stage } | { kind: "workflow"; slug: string };

// Workflows que por sí solos mueven al contacto (lib/workflows/executor.ts).
const STAGE_BY_WORKFLOW: Readonly<Record<string, Stage>> = { [SLUG_DATOS_BANCARIOS]: "cerca_compra" };

// La etapa más adelantada a la que llevaría al contacto una respuesta: por `mover_etapa`
// o por un workflow que mueve la etapa (datos bancarios → Cerca de compra).
export function impliedStage(signals: readonly StageSignal[]): Stage | null {
  let best: Stage | null = null;
  for (const s of signals) {
    const stage = s.kind === "etapa" ? s.etapa : (STAGE_BY_WORKFLOW[s.slug] ?? null);
    if (stage && (best === null || isForward(best, stage))) best = stage;
  }
  return best;
}

// Traspaso: contestó el modelo de una etapa del Modelo 1 y, con su respuesta, el contacto
// avanza a una etapa del Modelo 2 → devuelve esa etapa (la respuesta la escribe el Modelo
// 2). null si no hay traspaso: la etapa no avanza, sigue en etapas del Modelo 1, o los dos
// espacios usan el mismo modelo.
export function handoffStage(cfg: ModelConfig, current: string | null, implied: Stage | null): Stage | null {
  if (implied === null || cfg.modelo1 === cfg.modeloCerebro) return null;
  if (brainModelForStage(cfg, current).slot !== 1) return null;
  if (current !== null && isStage(current) && !isForward(current, implied)) return null;
  return brainModelForStage(cfg, implied).slot === 2 ? implied : null;
}
