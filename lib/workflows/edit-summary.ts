// Resumen de lo que se va a guardar en el editor de workflows (29-sep-2026, pedido del dueño:
// los cambios se hacen libres y UN solo aviso al guardar confirma todos juntos). PURO. Usa el
// mismo texto que el Historial ("Nombre: «A»", "3 pasos (editados)", "Cuándo: Solo al inicio"…),
// así lo que confirma el vendedor es lo mismo que después ve en Agente IA › Historial.
import { describeWorkflowEdit, workflowSummary, type WorkflowSnapshot } from "@/lib/historial/labels";
import type { StepPayload } from "./steps";

// Lo que el editor manda a guardar (mismo contenido que WorkflowInput, sin el id).
export type WorkflowFields = {
  name: string;
  enabled: boolean;
  agentDescription: string;
  triggerAgent: boolean;
  triggerKeywords: string[];
  triggerCommand: string | null;
  triggerStage: string | null;
  triggerStartOnly: boolean;
  steps: StepPayload[];
};

export type SaveSummary = { kind: "crear"; resumen: string } | { kind: "editar"; antes: string; despues: string } | { kind: "sin_cambios" };

/** `stageName(clave)` = el nombre de la columna del Embudo (las etapas son editables). */
export function saveSummary(before: WorkflowFields | null, after: WorkflowFields, stageName: (key: string) => string): SaveSummary {
  const snap = (w: WorkflowFields): WorkflowSnapshot => ({ ...w, triggerStage: w.triggerStage ? stageName(w.triggerStage) : null });
  if (!before) return { kind: "crear", resumen: workflowSummary(snap(after)) };
  const edit = describeWorkflowEdit(snap(before), snap(after));
  return edit ? { kind: "editar", antes: edit.before, despues: edit.after } : { kind: "sin_cambios" };
}
