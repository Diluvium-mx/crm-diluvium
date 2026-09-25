// Etapas del Embudo (PURO, sin BD): orden y comparación. La escritura vive en
// lib/contacts/stage.ts (moveStageForward).
export const STAGES = ["inbox", "prospecto", "interesado", "cerca_compra", "compra"] as const;
export type Stage = (typeof STAGES)[number];
export type StageChangedBy = "vendedor" | "agente" | "sistema";

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

// ¿`to` está más adelante que `from`?
export function isForward(from: Stage, to: Stage): boolean {
  return STAGES.indexOf(to) > STAGES.indexOf(from);
}
