// Búsqueda SIN acentos, ñ ni mayúsculas: la regla de TODO buscador del CRM
// (CLAUDE.md §6). "ramon" encuentra a "Ramón", "pena" a "Peña", "instalacion" a
// "instalación". En el cliente se usa matchesSearch; en el servidor, el término
// se normaliza aquí y se compara contra la columna normalizada en SQL con
// `sqlNormalized(...)` (misma tabla de letras; sin extensión unaccent).

// Letras acentuadas que Postgres con locale C NO baja a minúsculas con lower():
// se listan a mano, mayúsculas y minúsculas, para que el SQL las cubra igual.
const ACCENTED = "áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ";
const PLAIN = "aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunncc";

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesSearch(text: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  return normalizeSearch(text).includes(q);
}

/**
 * Expresión SQL (texto) que normaliza una columna igual que normalizeSearch:
 * translate() quita acentos y ñ en mayúsculas y minúsculas ANTES de lower(),
 * así funciona aunque la base tenga locale C. `column` debe ser SQL ya seguro
 * (un identificador o expresión de Drizzle), nunca texto del usuario.
 */
export const SQL_SEARCH_FROM = ACCENTED;
export const SQL_SEARCH_TO = PLAIN;
