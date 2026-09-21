// Reglas puras de las variables POSICIONALES de una plantilla de Meta: {{1}},
// {{2}}, … (sin base de datos, se testea solo). Distinto de los Fragmentos, que
// usan variables con NOMBRE (lib/snippets/variables.ts).
import type { TemplateVariable } from "@/lib/templates/types";

// Solo dígitos dentro de las llaves: {{1}}. Un {{nombre}} NO es variable de
// plantilla. Instancia nueva por llamada (no compartir lastIndex).
const POS_SRC = "\\{\\{\\s*(\\d+)\\s*\\}\\}";

/** Índice posicional más alto del cuerpo ({{3}} → 3). 0 si no hay variables. */
export function templateMaxIndex(bodyText: string | null): number {
  if (!bodyText) return 0;
  let max = 0;
  for (const match of bodyText.matchAll(new RegExp(POS_SRC, "g"))) {
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return max;
}

/**
 * Variables del cuerpo (1..máximo), con su ejemplo si viene. Se toma el máximo
 * (no la cantidad de distintos) para que un hueco —p. ej. {{1}} y {{3}}— igual
 * reserve su lugar y el envío pida los tres valores.
 */
export function templateVariablesFromBody(bodyText: string | null, examples: string[] = []): TemplateVariable[] {
  const count = templateMaxIndex(bodyText);
  const out: TemplateVariable[] = [];
  for (let i = 1; i <= count; i++) {
    const example = examples[i - 1];
    out.push(example ? { index: i, example } : { index: i });
  }
  return out;
}

/**
 * Rellena el cuerpo con los valores en orden ({{1}} → params[0], …). Un {{n}}
 * sin valor se deja tal cual (para la vista previa; el envío valida que estén
 * todos). Se usa para la burbuja del hilo cuando se manda una plantilla.
 */
export function renderTemplateBody(bodyText: string, params: string[]): string {
  return bodyText.replace(new RegExp(POS_SRC, "g"), (whole: string, digits: string) => {
    const i = Number(digits);
    return i >= 1 && i <= params.length ? params[i - 1] : whole;
  });
}
