// Complemento de un workflow «El workflow es la respuesta» por palabra clave (30-sep-2026). PURO.
//
// Caso del 29-sep, 6:22 p.m.: «De que cd son y que precio tienen» disparó «Precio 2» por
// "precio"; el workflow contestó el precio y terminó con su pregunta, su último mensaje dejó el
// mensaje como contestado y nadie le dijo de qué ciudad somos. Ahora el workflow contesta SU tema
// y el Agente IA revisa el mismo mensaje: contesta lo que falte, sin repetir al workflow y sin
// hacer preguntas (ahora le toca contestar al cliente), o no escribe nada si no falta nada.
import { NOTHING_TOKEN } from "./brain";

// El ÚLTIMO mensaje pendiente del cliente es el que contestó el workflow: modo complemento.
export function complementNote(workflowName: string): string {
  return (
    `El workflow «${workflowName}» ya le contestó al cliente su último mensaje con lo que aparece en "[Después de este mensaje ya se le envió al cliente: …]". ` +
    "Ese workflow contesta solo su tema (p. ej. el precio o la tabla de tamaños). Revisa si el último mensaje del cliente (o los que mandó seguidos) trae OTRA pregunta o petición que el workflow no contestó (p. ej. de qué ciudad son, envíos, instalación, garantía o formas de pago). " +
    "Si la hay, contéstala breve, sin repetir nada de lo que ya dijo el workflow y SIN hacer preguntas: ahora le toca contestar al cliente. " +
    `Si el workflow ya contestó todo (un saludo o un "gracias" no necesitan respuesta aparte), escribe exactamente ${NOTHING_TOKEN} y nada más; las acciones internas (detalle, etapa, avisos) sí puedes usarlas.`
  );
}

// El cliente siguió escribiendo después de lo que mandó el workflow: se contesta como siempre,
// sin repetir lo del workflow.
export function partialNote(workflowName: string): string {
  return `El workflow «${workflowName}» ya contestó una parte de lo que escribió el cliente (sus mensajes están en la conversación): no repitas lo que dijo; contesta lo que haya quedado sin respuesta y lo nuevo que escribió el cliente.`;
}

// Lo que va al final de una pregunta: espacios, signos y emojis (no letras ni números).
const TAIL = /[^\p{L}\p{N}]*$/u;
// Fin de oración antes de una pregunta sin «¿» ("Somos de Mazatlán. Le interesa?").
const SENTENCE_END = /[.!…\n]/gu;

// Quita la pregunta con que termina un texto («¿…?» o, sin «¿», la última oración que termina en
// «?»). null = no terminaba en pregunta.
function dropClosingQuestion(text: string): string | null {
  const t = text.trim();
  const body = t.replace(TAIL, "");
  if (!t.slice(body.length).includes("?")) return null;
  let start = body.lastIndexOf("¿");
  if (start === -1) {
    let last = -1;
    for (let m = SENTENCE_END.exec(body); m; m = SENTENCE_END.exec(body)) last = m.index;
    SENTENCE_END.lastIndex = 0;
    start = last + 1;
  }
  return t.slice(0, start).replace(/[\s,;:—–-]+$/u, "").trim();
}

/**
 * Modo complemento: el Agente IA no pregunta (el workflow ya marcó el siguiente paso). Quita la
 * pregunta final de cada mensaje («Somos de Mazatlán. ¿De dónde nos escribe?» → «Somos de
 * Mazatlán.») y los mensajes que solo eran pregunta. `dropped`: lo que no sale (para el registro).
 */
export function withoutClosingQuestions(bubbles: readonly string[]): { keep: string[]; dropped: string[] } {
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const bubble of bubbles) {
    let text = bubble.trim();
    for (let i = 0; i < 3; i++) {
      const cut = dropClosingQuestion(text);
      if (cut === null) break;
      dropped.push(text.slice(cut.length).trim());
      text = cut;
    }
    if (/[\p{L}\p{N}]/u.test(text)) keep.push(text);
  }
  return { keep, dropped };
}
