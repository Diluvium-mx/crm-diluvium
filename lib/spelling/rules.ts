// Reglas del corrector ortográfico (20-oct-2026, docs/corrector.md): cuándo una palabra
// está mal escrita y qué se sugiere. Corren dentro del Web Worker sobre el diccionario
// abierto de español de México (Hunspell/LibreOffice, `public/diccionario/`), y en las
// pruebas sobre el mismo diccionario de node_modules.

import { normalizeSearch } from "@/lib/text/search";

/** Lo mínimo que el corrector necesita del diccionario (nspell lo cumple). */
export type Dictionary = {
  correct(word: string): boolean;
  suggest(word: string): string[];
};

export const MAX_SUGGESTIONS = 3;

// Palabras que el diccionario no trae y que en Diluvium siempre están bien. Las del
// equipo se agregan desde el menú («Agregar al diccionario», tabla `spelling_words`).
export const BASE_WORDS: ReadonlySet<string> = new Set([
  "diluvium",
  "ok",
  "okay",
  "whatsapp",
  "instagram",
  "facebook",
  "messenger",
  "tiktok",
  "google",
  "maps",
  "mochis",
  "mazatlán",
  "culiacán",
  "sinaloa",
  "sonora",
  "cdmx",
  "pvc",
  "cm",
  "mm",
  "mt",
  "mts",
  "kg",
  "km",
  "pza",
  "pzas",
]);

// Letras sueltas que sí son palabras en español.
const SINGLE_LETTER_WORDS = new Set(["a", "e", "o", "u", "y"]);

// Atajos de chat: el diccionario los marca, pero no sabría qué sugerir.
const SHORTCUTS: Readonly<Record<string, string[]>> = {
  q: ["que"],
  k: ["que"],
  x: ["por"],
  d: ["de"],
  xq: ["porque", "por qué"],
  xk: ["porque", "por qué"],
  pq: ["porque", "por qué"],
  porq: ["porque", "por qué"],
  porfa: ["por favor"],
  porfavor: ["por favor"],
  xfa: ["por favor"],
  deacuerdo: ["de acuerdo"],
  aver: ["a ver", "haber"],
  osea: ["o sea"],
  nose: ["no sé"],
  tmb: ["también"],
  tb: ["también"],
  tambn: ["también"],
  bn: ["bien"],
  aki: ["aquí"],
};

// Pronombres pegados al verbo (trato de usted): «mándeme», «cotizarle», «envíeselo».
// El diccionario no trae todas las combinaciones; se quita el pronombre y se revisa el verbo.
const CLITICS = [
  "selos", "selas", "seles", "noslo", "nosla", "noslos", "noslas",
  "selo", "sela", "sele", "melo", "mela", "melos", "melas", "telo", "tela",
  "nos", "los", "las", "les", "me", "te", "le", "lo", "la", "se",
];
const ACUTE: Readonly<Record<string, string>> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
const ADD_ACUTE: Readonly<Record<string, string>> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ" };

function stripAcute(word: string): string {
  return word.replace(/[áéíóú]/g, (c) => ACUTE[c] ?? c);
}

function isAllCaps(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase();
}

function knownWithClitic(word: string, dict: Dictionary): boolean {
  const lower = word.toLowerCase();
  for (const clitic of CLITICS) {
    if (!lower.endsWith(clitic)) continue;
    const base = lower.slice(0, -clitic.length);
    if (base.length < 3 || !/[aeiouáéíóúrdn]$/.test(base)) continue;
    if (dict.correct(base) || dict.correct(stripAcute(base))) return true;
  }
  return false;
}

/** ¿La palabra está mal escrita? (las del diccionario del equipo se revisan aparte). */
export function isMisspelled(word: string, dict: Dictionary): boolean {
  const lower = word.toLowerCase();
  if (lower.length === 1) return !SINGLE_LETTER_WORDS.has(lower);
  // Siglas en mayúsculas (IVA, CFE, PVC): no se revisan.
  if (isAllCaps(word)) return false;
  if (BASE_WORDS.has(lower)) return false;
  if (dict.correct(word) || dict.correct(lower)) return false;
  return !knownWithClitic(word, dict);
}

// Primero lo que solo difiere en un acento o una ñ («cotizacion» → «cotización»).
function accentVariants(word: string, dict: Dictionary): string[] {
  const lower = word.toLowerCase();
  const out: string[] = [];
  for (let i = 0; i < lower.length; i++) {
    const swap = ADD_ACUTE[lower[i]];
    if (!swap) continue;
    const candidate = lower.slice(0, i) + swap + lower.slice(i + 1);
    if (dict.correct(candidate)) out.push(candidate);
  }
  return out;
}

function keepCase(original: string, suggestion: string): string {
  const first = original[0];
  if (first && first !== first.toLowerCase()) return suggestion[0].toUpperCase() + suggestion.slice(1);
  return suggestion;
}

/** Hasta 3 sugerencias, la más probable primero, con la mayúscula inicial del original. */
export function suggestionsFor(word: string, dict: Dictionary): string[] {
  const lower = word.toLowerCase();
  const key = normalizeSearch(word);
  const fromDict = dict
    .suggest(word)
    .map((s, index) => ({ s, index, sameLetters: normalizeSearch(s) === key }))
    .sort((a, b) => Number(b.sameLetters) - Number(a.sameLetters) || a.index - b.index)
    .map(({ s }) => s);
  const all = [...(SHORTCUTS[lower] ?? []), ...accentVariants(word, dict), ...fromDict];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of all) {
    const k = s.toLowerCase();
    if (k === lower || seen.has(k)) continue;
    seen.add(k);
    out.push(keepCase(word, s));
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Clave con la que se guarda y se compara una palabra del diccionario del equipo. */
export function customWordKey(word: string): string {
  return word.trim().toLowerCase();
}
