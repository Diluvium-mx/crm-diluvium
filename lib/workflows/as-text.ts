// Botón «Copiar» de Automatización › Workflows (28-sep-2026, pedido del dueño: pegarlos en
// una IA para mejorarlos). PURO. Igual que las FAQs (faqsAsText): cada workflow con un
// guion, sin números, su detalle debajo con sangría y una línea en blanco entre workflows.
// Los pasos van en su orden, también con guion, y los textos COMPLETOS (no recortados).
import { maxSendsLabel, START_SCOPE_LABEL, startScopeOf, type StepPayload } from "./steps";

export type WorkflowForText = {
  name: string;
  enabled: boolean;
  agentDescription: string;
  triggerAgent: boolean;
  triggerCommand: string | null;
  triggerKeywords: readonly string[];
  triggerStage: string | null;
  triggerStartOnly: boolean;
  triggerStartOnlyAgent: boolean;
  maxSendsPerChat: number | null;
  isAnswer: boolean;
  steps: readonly StepPayload[];
  missingMedia: readonly string[];
};

// Un texto de varios renglones: el primero va junto a la etiqueta y los demás con la
// sangría de `pad` (así se lee como un solo bloque).
function block(label: string, text: string, pad: string): string {
  const lines = text.trim().split(/\r?\n/u).map((line) => line.trimEnd());
  return [`${label}${lines[0] ?? ""}`, ...lines.slice(1).map((line) => (line ? `${pad}${line}` : ""))].join("\n");
}

function stepText(step: StepPayload): string {
  const pad = "      ";
  switch (step.kind) {
    case "wait":
      return `    - Esperar ${step.seconds} s`;
    case "send_text":
      return block("    - Texto: ", step.text, pad);
    case "send_media": {
      const file = `    - Archivo: ${step.title}${step.assetId ? "" : " (falta archivo)"}`;
      return step.caption?.trim() ? `${file}\n${block("      Texto del archivo: ", step.caption, "        ")}` : file;
    }
  }
}

/** `stageLabel(clave)` = el nombre de la columna del Embudo (las etapas son editables). */
export function workflowsAsText(workflows: readonly WorkflowForText[], stageLabel: (key: string) => string): string {
  return workflows
    .map((w) => {
      const state = w.enabled ? "encendido" : w.missingMedia.length > 0 ? "apagado, falta archivo" : "apagado";
      const triggers = [
        w.triggerAgent ? "el Agente IA" : null,
        w.triggerCommand ? `comando del vendedor ${w.triggerCommand}` : null,
        w.triggerKeywords.length > 0 ? `palabras clave del cliente: ${w.triggerKeywords.join(", ")}` : null,
        w.triggerStage ? `al entrar a la etapa ${stageLabel(w.triggerStage)}` : null,
      ].filter((t): t is string => t !== null);
      const lines = [
        `- ${w.name.trim()} — ${state}`,
        `  Se dispara con: ${triggers.length > 0 ? triggers.join(" · ") : "nada (no se dispara solo)"}`,
      ];
      // «Solo al inicio» solo se anota cuando aplica (palabra clave o Agente IA).
      const scope = startScopeOf(w);
      if (scope === "inicio" && (w.triggerAgent || w.triggerKeywords.length > 0)) {
        lines.push("  Solo al inicio: antes de que el Agente IA o un vendedor le contesten, una sola vez por cliente");
      } else if (scope === "inicio_palabra_clave" && w.triggerKeywords.length > 0) {
        lines.push(`  ${START_SCOPE_LABEL.inicio_palabra_clave}: la palabra clave solo antes de que el Agente IA o un vendedor le contesten, una sola vez por cliente`);
      }
      if (w.maxSendsPerChat) lines.push(`  Máximo por chat: ${maxSendsLabel(w.maxSendsPerChat)}`);
      if (w.isAnswer) lines.push("  El workflow es la respuesta: el Agente IA no agrega nada y espera a que el cliente conteste");
      if (w.triggerAgent && w.agentDescription.trim()) lines.push(block("  Cuándo lo usa el Agente IA: ", w.agentDescription, "    "));
      lines.push(w.steps.length > 0 ? "  Pasos:" : "  Pasos: ninguno");
      for (const step of w.steps) lines.push(stepText(step));
      return lines.join("\n");
    })
    .join("\n\n");
}
