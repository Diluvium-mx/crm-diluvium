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

/**
 * ¿La plantilla necesita parámetros que el CRM NO sabe construir hoy? El envío
 * solo arma el componente BODY (variables posicionales del cuerpo). Por eso una
 * plantilla con variables en el ENCABEZADO (texto con {{}} o media/ubicación) o
 * en un BOTÓN (URL dinámica, código OTP) NO es enviable desde aquí: se detecta
 * al sincronizar y se marca no enviable, en vez de ofrecerla y que WhatsApp la
 * rechace justo fuera de la ventana de 24 h. FOOTER y encabezado/botón estáticos
 * sí son soportados.
 */
export function templateRequiresUnsupportedParams(components: unknown): boolean {
  if (!Array.isArray(components)) return false;
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const component = raw as Record<string, unknown>;
    const type = typeof component.type === "string" ? component.type.toUpperCase() : "";
    if (type === "HEADER") {
      const format = typeof component.format === "string" ? component.format.toUpperCase() : "TEXT";
      if (format !== "TEXT") return true; // media/ubicación en el encabezado necesita parámetro
      if (typeof component.text === "string" && component.text.includes("{{")) return true; // variable en el encabezado
    } else if (type === "BUTTONS") {
      const buttons = Array.isArray(component.buttons) ? component.buttons : [];
      for (const raw2 of buttons) {
        if (!raw2 || typeof raw2 !== "object") continue;
        const button = raw2 as Record<string, unknown>;
        const btnType = typeof button.type === "string" ? button.type.toUpperCase() : "";
        if (typeof button.url === "string" && button.url.includes("{{")) return true; // URL dinámica
        if (btnType === "COPY_CODE" || btnType === "OTP") return true; // requiere un código
      }
    }
  }
  return false;
}
