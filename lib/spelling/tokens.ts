// Palabras de un texto que el corrector revisa (corrector ortográfico, 20-oct-2026,
// docs/corrector.md). Se saltan las que no son lenguaje: enlaces, correos, @usuarios,
// variables {{nombre}}, comandos "/tabla" y todo lo que lleve números (2.40m, m2, 6688…).

export type WordToken = { word: string; start: number; end: number };

// Lo que se tapa antes de buscar palabras (se respeta su largo para no mover posiciones).
const SKIP = [
  /\bhttps?:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /\b\S+\.(?:com|mx|net|org|app|io)(?:\/\S*)?\b/gi,
  /\S+@\S+/g,
  /@\w+/g,
  /\{\{[^}]*\}\}/g,
  /(?:^|\s)\/\S+/g,
];

// Letras (con acentos y ñ) unidas; un número pegado descarta toda la palabra.
const WORD = /[\p{L}\p{N}]+/gu;
const HAS_DIGIT = /\p{N}/u;

export function findWords(text: string): WordToken[] {
  let masked = text;
  for (const re of SKIP) masked = masked.replace(re, (m) => " ".repeat(m.length));
  const out: WordToken[] = [];
  for (const m of masked.matchAll(WORD)) {
    const word = m[0];
    if (HAS_DIGIT.test(word)) continue;
    out.push({ word, start: m.index, end: m.index + word.length });
  }
  return out;
}
