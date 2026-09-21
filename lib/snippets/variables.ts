// Variables con NOMBRE de los Fragmentos: {{nombre}}, {{ciudad}}, … Texto libre
// nuestro (distinto de las plantillas de Meta, que usan posicionales {{1}}).
// Puro y sin base de datos: se testea solo.

// Un token es {{ ... }} con lo de adentro recortado. El nombre válido empieza
// por letra/dígito/guion bajo y sigue con letras, dígitos, espacio, guion o
// guion bajo (acentos incluidos vía \p{L}). Se construye una instancia nueva en
// cada llamada para no compartir `lastIndex` entre matchAll y replace.
const TOKEN_SRC = "\\{\\{\\s*([^{}]+?)\\s*\\}\\}";
const NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u;

/**
 * Nombres de las variables del cuerpo, en orden de aparición y sin repetir.
 * Ignora tokens con un nombre no válido (p. ej. `{{ }}` o con saltos de línea).
 */
export function extractVariables(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(new RegExp(TOKEN_SRC, "gu"))) {
    const name = match[1].trim();
    if (!NAME_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Rellena el cuerpo con los valores dados (por nombre de variable). Una variable
 * sin valor se DEJA como `{{nombre}}` (para que el vendedor vea que falta, en vez
 * de mandar un hueco vacío). Tokens con nombre no válido se dejan tal cual.
 */
export function renderSnippet(body: string, values: Record<string, string>): string {
  return body.replace(new RegExp(TOKEN_SRC, "gu"), (whole: string, rawName: string) => {
    const name = rawName.trim();
    if (!NAME_RE.test(name)) return whole;
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole;
  });
}
