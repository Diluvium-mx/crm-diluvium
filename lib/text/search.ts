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

// Búsqueda DENTRO de los chats (la lupa amarilla de la Bandeja y el Embudo, 29-sep-2026):
// mínimo 3 letras para que "de" no marque todos los chats, y un tope de largo.
export const CHAT_SEARCH_MIN_LENGTH = 3;
const CHAT_SEARCH_MAX_LENGTH = 100;

/** Término normalizado de la búsqueda en los chats; null = aún no alcanza el mínimo. */
export function chatSearchTerm(raw: string | null | undefined): string | null {
  const term = normalizeSearch(raw ?? "").slice(0, CHAT_SEARCH_MAX_LENGTH).trim();
  return term.length >= CHAT_SEARCH_MIN_LENGTH ? term : null;
}

/** Escapa %, _ y \ para usar un texto del usuario dentro de un LIKE '%…%'. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Expresión SQL (texto) que normaliza una columna igual que normalizeSearch:
 * translate() quita acentos y ñ en mayúsculas y minúsculas ANTES de lower(),
 * así funciona aunque la base tenga locale C. `column` debe ser SQL ya seguro
 * (un identificador o expresión de Drizzle), nunca texto del usuario.
 */
export const SQL_SEARCH_FROM = ACCENTED;
export const SQL_SEARCH_TO = PLAIN;
