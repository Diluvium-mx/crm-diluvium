// Reglas puras de las variables POSICIONALES de una plantilla de Meta: {{1}},
// {{2}}, … (sin base de datos, se testea solo). Distinto de los Fragmentos, que
// usan variables con NOMBRE (lib/snippets/variables.ts).
import type { TemplateVariable } from "@/lib/templates/types";

// Tope de variables por plantilla: acota los bucles y las asignaciones de
// arreglos para que un {{999999999}} malformado no cuelgue la sincronización ni
// reviente la UI. Generoso (Meta permite pocas); más = plantilla sospechosa.
export const MAX_TEMPLATE_VARS = 50;

// Solo 1-3 dígitos dentro de las llaves: {{1}}..{{999}} (no parsea números
// enormes). Un {{nombre}} NO es variable posicional. Instancia nueva por llamada
// (no compartir lastIndex).
const POS_SRC = "\\{\\{\\s*(\\d{1,3})\\s*\\}\\}";
// Cualquier token {{…}}, para detectar placeholders NO soportados (con nombre,
// fuera de rango o con huecos).
const ANY_PLACEHOLDER_SRC = "\\{\\{\\s*([^{}]+?)\\s*\\}\\}";

/** Índice posicional más alto del cuerpo ({{3}} → 3), acotado a MAX_TEMPLATE_VARS. 0 si no hay. */
export function templateMaxIndex(bodyText: string | null): number {
  if (!bodyText) return 0;
  let max = 0;
  for (const match of bodyText.matchAll(new RegExp(POS_SRC, "g"))) {
    const n = Number(match[1]);
    if (n >= 1 && n <= MAX_TEMPLATE_VARS && n > max) max = n;
  }
  return max;
}

/**
 * ¿El cuerpo tiene placeholders que el CRM no sabe rellenar? Verdadero si hay
 * variables con NOMBRE ({{cliente}}), numéricas fuera de rango ({{0}}, {{99}},
 * {{999999999}}), o posicionales con HUECOS (p. ej. {{1}} y {{3}} sin {{2}}:
 * WhatsApp las exige contiguas desde 1). Solo {{1}}..{{N}} contiguas (N ≤ 50)
 * son soportadas.
 */
export function bodyHasUnsupportedPlaceholders(bodyText: string | null): boolean {
  if (!bodyText) return false;
  const indices = new Set<number>();
  for (const match of bodyText.matchAll(new RegExp(ANY_PLACEHOLDER_SRC, "g"))) {
    const inner = match[1].trim();
    if (!/^\d{1,3}$/.test(inner)) return true; // con nombre / no numérico
    const n = Number(inner);
    if (n < 1 || n > MAX_TEMPLATE_VARS) return true; // fuera de rango
    indices.add(n);
  }
  if (indices.size === 0) return false;
  // Contiguas 1..max: sin huecos, el tamaño del conjunto es igual al máximo.
  return indices.size !== Math.max(...indices);
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

// ─── Alta y edición desde el CRM (28-sep-2026) ───────────────────────────────

/** Largo máximo del cuerpo de una plantilla (Meta, componente BODY). */
export const TEMPLATE_BODY_MAX = 1024;
/** Largo máximo del nombre de una plantilla (Meta). */
export const TEMPLATE_NAME_MAX = 512;
/** Solo minúsculas, números y guion bajo: la regla de Meta para el nombre. */
export const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

/** Estados en los que Meta deja editar una plantilla (Zernio: APPROVED, REJECTED o PAUSED). */
const EDITABLE_STATUSES = new Set(["APPROVED", "REJECTED", "PAUSED"]);

export function isTemplateEditable(status: string): boolean {
  return EDITABLE_STATUSES.has(status.toUpperCase());
}

/**
 * Nombre que escribe una persona ("Hola buenas tardes", "Seguimiento – protección")
 * → nombre válido para Meta ("hola_buenas_tardes", "seguimiento_proteccion"):
 * minúsculas, sin acentos (la ñ pasa a n), y todo lo que no sea letra o número
 * se vuelve UN guion bajo; sin guiones bajos al inicio ni al final.
 */
export function templateNameFromLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, TEMPLATE_NAME_MAX)
    .replace(/_+$/, "");
}

/**
 * Primer problema del cuerpo que haría que Meta la rechace (o que el CRM no pueda
 * mandarla), en palabras del vendedor; null si está bien. Revisa lo que Meta deja
 * por escrito: variables {{1}}, {{2}}… seguidas, ninguna al inicio ni al final del
 * texto, 1,024 caracteres como máximo y un ejemplo por variable.
 */
export function templateBodyProblem(bodyText: string, examples: readonly string[]): string | null {
  const body = bodyText.trim();
  if (!body) return "Escribe el texto de la plantilla.";
  if (body.length > TEMPLATE_BODY_MAX) {
    return `El texto tiene ${body.length.toLocaleString("es-MX")} caracteres; Meta acepta hasta ${TEMPLATE_BODY_MAX.toLocaleString("es-MX")}.`;
  }
  if (bodyHasUnsupportedPlaceholders(body)) {
    return "Las variables van con número y seguidas: {{1}}, {{2}}, {{3}}… (sin nombres y sin saltarse números).";
  }
  const edge = new RegExp(`^${POS_SRC}|${POS_SRC}$`);
  if (edge.test(body)) {
    return "Meta no acepta que el texto empiece o termine con una variable: agrega texto antes y después de {{1}}.";
  }
  const expected = templateMaxIndex(body);
  if (examples.length !== expected) {
    return expected === 0 ? "El texto no tiene variables: no lleva ejemplos." : `Da un ejemplo para cada variable (${expected}).`;
  }
  if (examples.some((e) => !e.trim())) return "Da un ejemplo para cada variable.";
  if (examples.some((e) => /[\n\t]/.test(e))) return "Los ejemplos van en una sola línea.";
  return null;
}

/**
 * Componentes de una plantilla con el BODY cambiado (para editarla): Meta
 * reemplaza TODOS los componentes al editar, así que se conservan tal cual los
 * demás (encabezado, pie, botones) y solo se cambian el texto y el ejemplo del
 * BODY. Si no había BODY, se agrega. No muta la entrada.
 */
export function replaceBodyComponent(
  components: readonly unknown[],
  bodyText: string,
  bodyExample: readonly string[],
): Record<string, unknown>[] {
  const body = (base: Record<string, unknown>): Record<string, unknown> => {
    const rest = Object.fromEntries(Object.entries(base).filter(([key]) => key !== "example"));
    return bodyExample.length > 0
      ? { ...rest, text: bodyText, example: { body_text: [[...bodyExample]] } }
      : { ...rest, text: bodyText };
  };
  let found = false;
  const out = components.map((raw) => {
    const component = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
    const type = typeof component.type === "string" ? component.type.toUpperCase() : "";
    if (type !== "BODY" || found) return component;
    found = true;
    return body(component);
  });
  if (!found) out.push(body({ type: "BODY" }));
  return out;
}
