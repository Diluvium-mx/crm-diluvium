// Acuse corto del cliente al final del chat (10-oct-2026, docs/seguimientos.md §21). PURO: lo usan el lector (para pedir
// la ficha de seguimiento) y la píldora (para decir por qué todavía no hay uno).

export type AckMessage = { direction: "in" | "out"; type: string; body: string | null };

/**
 * Un acuse corto del cliente: hasta 40 letras sin pregunta ni números («de acuerdo», «ok gracias», 👍) o un sticker.
 * Con números es un dato («Mide 1.20 m», «son 2»): espera respuesta, no es acuse.
 */
export const ACUSE_MAX_CHARS = 40;
function isShortAck(m: AckMessage): boolean {
  if (m.type === "sticker") return true;
  if (m.type !== "text") return false;
  const text = (m.body ?? "").trim();
  return text.length > 0 && text.length <= ACUSE_MAX_CHARS && !/[?¿\d]/.test(text);
}

/**
 * ¿El chat termina con un acuse corto del cliente después de nuestro último mensaje? (10-oct-2026: «De acuerdo» tras
 * «cuando se anime, mándeme la foto» dejaba el chat sin seguimiento porque el último mensaje no era nuestro y el
 * Agente IA, con razón, no contesta un acuse). Entonces también se pide la ficha y el lector decide si de verdad solo
 * acusa recibo (seguimiento) o espera respuesta (no seguir).
 */
export function endsWithClientAck(rows: readonly AckMessage[]): boolean {
  let i = rows.length;
  while (i > 0 && rows[i - 1].direction === "in") i--;
  if (i === 0 || i === rows.length) return false;
  return rows.slice(i).every(isShortAck);
}
