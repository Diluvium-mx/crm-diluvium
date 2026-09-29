// Dónde está la palabra buscada dentro de un texto (resaltado amarillo de la búsqueda en
// los chats, 29-sep-2026). Misma regla que todo buscador (search.ts): sin acentos, ñ ni
// mayúsculas, así "culiacan" resalta "Culiacán". PURO: lo usan la lista de la Bandeja y
// el chat (Bandeja y pop-up del Embudo).

// Cada letra se normaliza SOLA para saber a qué posición del texto original corresponde
// cada letra del texto normalizado ("Á" → "a" sigue siendo una letra).
function normalizeChar(char: string): string {
  return char.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Tramos [inicio, fin) del texto ORIGINAL donde aparece `term` (ya normalizado con
 * chatSearchTerm/normalizeSearch). Sin empalmes: después de una coincidencia se sigue
 * buscando a partir de su final.
 */
export function searchRanges(text: string, term: string): Array<[number, number]> {
  if (!term || !text) return [];
  let normalized = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const char of normalizeChar(text[i])) {
      normalized += char;
      origin.push(i);
    }
  }
  const ranges: Array<[number, number]> = [];
  let at = normalized.indexOf(term);
  while (at >= 0) {
    ranges.push([origin[at], origin[at + term.length - 1] + 1]);
    at = normalized.indexOf(term, at + term.length);
  }
  return ranges;
}

export type HighlightPart = { text: string; hit: boolean };

/** El texto partido en pedazos normales y coincidencias (para pintar las coincidencias). */
export function highlightParts(text: string, term: string | null): HighlightPart[] {
  const ranges = term ? searchRanges(text, term) : [];
  if (ranges.length === 0) return [{ text, hit: false }];
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start > last) parts.push({ text: text.slice(last, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    last = end;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}

/**
 * Pedazo del texto alrededor de la primera coincidencia (vista previa de la fila en la
 * Bandeja): hasta `lead` letras antes, con "…" si se recortó. Una sola línea.
 */
export function snippetAround(text: string, term: string, lead = 12): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const [first] = searchRanges(flat, term);
  if (!first || first[0] <= lead) return flat;
  // Se corta en un espacio para no partir una palabra, si hay uno cerca.
  let start = first[0] - lead;
  const space = flat.indexOf(" ", start);
  if (space >= 0 && space < first[0]) start = space + 1;
  return `…${flat.slice(start)}`;
}
