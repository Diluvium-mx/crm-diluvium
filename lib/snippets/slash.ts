// Buscador de Fragmentos con "/" en el composer (como las respuestas rápidas de
// GHL): lógica pura, sin React ni base de datos, para poder testearla sola.

export type SlashQuery = {
  /** Índice del "/" en el borrador. */
  start: number;
  /** Índice del cursor (fin del texto a reemplazar). */
  end: number;
  /** Lo escrito después del "/" (lo que filtra). */
  query: string;
};

const MAX_QUERY = 40;

/**
 * ¿Hay una búsqueda abierta justo antes del cursor? El "/" cuenta solo al
 * inicio del borrador o después de un espacio o salto de línea (así una URL o
 * "1/2" no la abren), y entre el "/" y el cursor no puede haber saltos de línea.
 */
export function findSlashQuery(text: string, caret: number): SlashQuery | null {
  const before = text.slice(0, caret);
  const slash = before.lastIndexOf("/");
  if (slash < 0) return null;
  if (slash > 0 && !/\s/.test(before[slash - 1])) return null;
  const query = before.slice(slash + 1);
  if (/[\r\n]/.test(query) || query.length > MAX_QUERY) return null;
  return { start: slash, end: caret, query };
}

/** Minúsculas y sin acentos, para que "envio" encuentre "Envío". */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * Filtra por nombre y cuerpo. Orden: nombre que EMPIEZA con la búsqueda,
 * nombre que la contiene, cuerpo que la contiene. Con la búsqueda vacía
 * devuelve todos (en el orden recibido), hasta `limit`.
 */
export function filterSnippets<T extends { name: string; body: string }>(snippets: T[], query: string, limit = 8): T[] {
  const q = normalizeForSearch(query);
  if (!q) return snippets.slice(0, limit);
  const ranked: { snippet: T; rank: number; index: number }[] = [];
  snippets.forEach((snippet, index) => {
    const name = normalizeForSearch(snippet.name);
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : normalizeForSearch(snippet.body).includes(q) ? 2 : -1;
    if (rank >= 0) ranked.push({ snippet, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.slice(0, limit).map((r) => r.snippet);
}

/** Reemplaza "/búsqueda" por el texto elegido y devuelve dónde queda el cursor. */
export function applySlashInsert(text: string, slash: SlashQuery, insert: string): { text: string; caret: number } {
  const next = text.slice(0, slash.start) + insert + text.slice(slash.end);
  return { text: next, caret: slash.start + insert.length };
}
