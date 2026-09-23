// Etiquetas de la pestaña Automatización (puro).
import type { StepPayload } from "@/lib/workflows/steps";

export const STEP_LABEL: Record<StepPayload["kind"], string> = {
  send_text: "Texto",
  send_media: "Archivo",
  set_stage: "Etapa",
  handover: "Pasar a humano",
  add_tag: "Etiqueta",
  internal_note: "Aviso interno",
  wait: "Esperar",
};

export const STEP_ICON: Record<StepPayload["kind"], string> = {
  send_text: "💬",
  send_media: "📎",
  set_stage: "↗",
  handover: "🙋",
  add_tag: "🏷",
  internal_note: "📝",
  wait: "⏱",
};

export const TRIGGER_LABEL = {
  agent: "Agente",
  keyword: "Palabra clave",
  command: "Comando",
  stage: "Etapa",
} as const;

export const RUN_STATUS_LABEL = {
  queued: "En cola",
  running: "Ejecutando",
  done: "Hecho",
  failed: "Falló",
  cancelled: "Cancelado",
  skipped: "Omitido",
} as const;

export const SKIP_REASON_LABEL: Record<string, string> = {
  workflow_deshabilitado: "workflow deshabilitado",
  falta_archivo: "falta un archivo",
  ya_enviado: "ya se envió en esta conversación",
  canal_apagado: "el canal no está en automático",
  sin_pasos: "sin pasos",
  ventana_24h: "ventana de 24 h cerrada",
  atorado: "se atoró (worker)",
  respuesta_humana: "un vendedor respondió",
  cambio_de_modo: "cambió el modo del canal",
  agente_pausado: "agente pausado",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function stepSummary(step: StepPayload): string {
  switch (step.kind) {
    case "send_text":
      return step.text;
    case "send_media":
      return step.assetId ? `${step.title}${step.caption ? ` · "${step.caption}"` : ""}` : `⚠ Falta archivo: ${step.title}`;
    case "set_stage":
      return `→ ${step.stage}`;
    case "handover":
      return step.tag ? `etiqueta "${step.tag}"` : "pausa al agente y etiqueta";
    case "add_tag":
      return `"${step.tag}"`;
    case "internal_note":
      return step.text;
    case "wait":
      return `${step.seconds} s`;
  }
}
