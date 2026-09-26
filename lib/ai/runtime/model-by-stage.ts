// Qué modelo atiende una respuesta según la etapa del contacto (Fase E,
// 25-sep-2026). PURO (sin BD). Desde "Columnas del Embudo" el modelo de cada etapa
// vive en funnel_stages.model_slot (1 = Modelo 1, 2 = Modelo 2 = modelo_cerebro);
// sin etapa conocida (o una clave que ya no existe), el Modelo 2: si hay duda, que
// conteste el más capaz.
//
// 27-sep-2026 (decisión del dueño): el Modelo 1 califica y, en cuanto decide que el
// contacto pasa a una etapa del Modelo 2 (p. ej. Cerca de compra, aunque se salte
// etapas), esa MISMA respuesta la escribe el Modelo 2 (traspaso). Y si un modelo falla,
// contesta el otro; la tarjeta "El agente no pudo responder" sale solo si fallan los dos.
import { isForward, roleKey, stageByKey, type FunnelStage, type ModelSlot } from "@/lib/contacts/stages";
import { SLUG_DATOS_BANCARIOS } from "@/lib/workflows/defaults";

export type { ModelSlot } from "@/lib/contacts/stages";

/** Modelos de la organización + sus columnas del Embudo (con el modelo de cada una). */
export type ModelConfig = { modelo1: string; modeloCerebro: string; stages: readonly FunnelStage[] };

export function slotForStage(stages: readonly FunnelStage[], stage: string | null): ModelSlot {
  return stageByKey(stages, stage)?.modelSlot ?? 2;
}

export function brainModelForStage(cfg: ModelConfig, stage: string | null): { modelId: string; slot: ModelSlot } {
  return slotForStage(cfg.stages, stage) === 1 ? { modelId: cfg.modelo1, slot: 1 } : { modelId: cfg.modeloCerebro, slot: 2 };
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

// Lo que el modelo pidió en su respuesta, en lo que toca a la etapa (clave de funnel_stages).
export type StageSignal = { kind: "etapa"; etapa: string } | { kind: "workflow"; slug: string };

// La etapa más adelantada (en el ORDEN actual de las columnas) a la que llevaría al
// contacto una respuesta: por `mover_etapa` o por un workflow que mueve la etapa (datos
// bancarios → la etapa con papel "Cerca de compra", lib/workflows/executor.ts). Claves
// que ya no existen se ignoran.
export function impliedStage(stages: readonly FunnelStage[], signals: readonly StageSignal[]): string | null {
  let best: string | null = null;
  for (const s of signals) {
    const stage = s.kind === "etapa" ? s.etapa : s.slug === SLUG_DATOS_BANCARIOS ? roleKey([...stages], "cerca_compra") : null;
    if (!stage || !stageByKey(stages, stage)) continue;
    if (best === null || isForward(stages, best, stage)) best = stage;
  }
  return best;
}

// Traspaso: contestó el modelo de una etapa del Modelo 1 y, con su respuesta, el contacto
// avanza a una etapa del Modelo 2 → devuelve esa etapa (la respuesta la escribe el Modelo
// 2). null si no hay traspaso: la etapa no avanza, sigue en etapas del Modelo 1, o los dos
// espacios usan el mismo modelo.
export function handoffStage(cfg: ModelConfig, current: string | null, implied: string | null): string | null {
  if (implied === null || cfg.modelo1 === cfg.modeloCerebro) return null;
  if (brainModelForStage(cfg, current).slot !== 1) return null;
  if (current !== null && stageByKey(cfg.stages, current) && !isForward(cfg.stages, current, implied)) return null;
  return brainModelForStage(cfg, implied).slot === 2 ? implied : null;
}
