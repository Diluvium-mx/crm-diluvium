// Límite de texto de Instagram (docs/instagram.md): Meta rechaza un mensaje de más de
// 1,000 bytes en UTF-8 (una "á" o una "ñ" cuentan 2, un emoji 4). WhatsApp acepta 4,096
// caracteres, así que un texto que ahí sale en uno, en Instagram sale en varias partes.
// Se corta por lo más natural que quepa: párrafo, renglón, oración, palabra y, solo si
// una palabra sola no cabe, a la mitad (sin partir un carácter).

export const INSTAGRAM_TEXT_MAX_BYTES = 1000;

const encoder = new TextEncoder();
export const utf8Bytes = (text: string): number => encoder.encode(text).length;

// Separadores de mayor a menor preferencia. Cada uno se queda al final de su pedazo.
const SEPARATORS: RegExp[] = [/(?<=\n\n)/, /(?<=\n)/, /(?<=[.!?¡¿…]\s)/, /(?<=\s)/];

/** Corta `text` en partes de `maxBytes` como máximo, sin perder ni cambiar caracteres (salvo orillas). */
export function splitInstagramText(text: string, maxBytes = INSTAGRAM_TEXT_MAX_BYTES): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (utf8Bytes(clean) <= maxBytes) return [clean];
  return pack(clean, 0, maxBytes)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// Junta piezas consecutivas mientras quepan; una pieza que sola no cabe se corta con el
// siguiente separador.
function pack(text: string, level: number, maxBytes: number): string[] {
  if (utf8Bytes(text) <= maxBytes) return [text];
  if (level >= SEPARATORS.length) return hardCut(text, maxBytes);
  const pieces = text.split(SEPARATORS[level]).filter((p) => p.length > 0);
  if (pieces.length <= 1) return pack(text, level + 1, maxBytes);
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (utf8Bytes(piece) > maxBytes) {
      if (current) out.push(current);
      current = "";
      out.push(...pack(piece, level + 1, maxBytes));
      continue;
    }
    if (utf8Bytes(current + piece) <= maxBytes) {
      current += piece;
    } else {
      if (current) out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

// Último recurso: por caracteres completos (code points), nunca a la mitad de uno.
function hardCut(text: string, maxBytes: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const char of Array.from(text)) {
    if (utf8Bytes(current + char) > maxBytes) {
      out.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) out.push(current);
  return out;
}
