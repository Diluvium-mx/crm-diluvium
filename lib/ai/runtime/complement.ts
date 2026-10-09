// Complemento de un workflow «El workflow es la respuesta» por palabra clave (30-sep-2026). PURO.
//
// Caso del 29-sep, 6:22 p.m.: «De que cd son y que precio tienen» disparó «Precio 2» por
// "precio"; el workflow contestó el precio y terminó con su pregunta, su último mensaje dejó el
// mensaje como contestado y nadie le dijo de qué ciudad somos. Ahora el workflow contesta SU tema
// y el Agente IA revisa el mismo mensaje: contesta lo que falte, sin repetir al workflow y sin
// hacer preguntas (ahora le toca contestar al cliente), o no escribe nada si no falta nada.
// 9-oct-2026: también tras un workflow «es la respuesta» que pidió el propio Agente IA, traiga
// archivos («Dónde medir») o textos («Entrada mayor a 2.5 m»: «Tengo dos entradas: la puerta de
// 1.10 y la cochera de 5 metros» → el workflow contesta la cochera y el agente, la puerta).
import { NOTHING_TOKEN } from "./brain";

// Ráfagas (9-oct-2026, dueño): el cliente suele tocar una pregunta del anuncio («¿Cuánto tarda el
// envío?», «¿Cómo funciona?») y luego escribir «Precio». El workflow contesta el ÚLTIMO mensaje y el
// agente revisa la ráfaga completa: la nota nombra cada mensaje para que no se fije solo en el último
// (banco notas/banco-rafaga con los 23 casos reales del 1 al 9-oct). Lo revisado queda contestado
// (context.ts, answeredOnlySql): un saludo de la ráfaga ya no recibe un «Buenas tardes» aparte ~90 s
// después por el barrido.
const SAID_MAX = 8;
const SAID_CHARS = 160;

/** Lo que dijo un mensaje del cliente, en una línea, para nombrarlo en la nota del complemento. */
export function saidText(m: { type: string; body: string | null; transcripcion?: string | null }): string {
  const raw = m.type === "audio" ? (m.transcripcion?.trim() ? `[nota de voz] ${m.transcripcion.trim()}` : "[nota de voz sin transcribir]") : m.body?.trim() || `[${m.type}]`;
  const line = raw.replace(/\s+/g, " ");
  return line.length > SAID_CHARS ? `${line.slice(0, SAID_CHARS)}…` : line;
}

// El ÚLTIMO mensaje pendiente del cliente es el que contestó el workflow: modo complemento. `said`:
// los mensajes del cliente que el agente está revisando (saidText), del más viejo al último.
export function complementNote(workflowName: string, said: readonly string[]): string {
  const shown = said.slice(-SAID_MAX).map((t) => `«${t}»`).join(" · ");
  const review =
    said.length > 1
      ? `Antes de esa respuesta el cliente mandó estos ${said.length} mensajes seguidos: ${shown}. Revisa CADA uno, no solo el último: `
      : said.length === 1
        ? `Antes de esa respuesta el cliente mandó: ${shown}. Revisa `
        : "Revisa el último mensaje del cliente: ";
  return (
    `El workflow «${workflowName}» ya le contestó al cliente con lo que aparece en "[Después de este mensaje ya se le envió al cliente: …]". ` +
    "Ese workflow contesta solo SU tema (p. ej. el precio, la tabla de tamaños o una entrada más ancha de lo que fabricamos). " +
    review +
    "si alguno trae una pregunta o petición que el workflow no contestó de forma directa (p. ej. cuánto tarda el envío, de qué ciudad son o dónde están, cómo funciona, si es fácil de instalar, para qué tipo de puerta sirve, garantía, formas de pago u otra entrada con su propia medida), contéstala breve, sin repetir nada de lo que ya dijo el workflow y SIN hacer preguntas: ahora le toca contestar al cliente. " +
    "Que el workflow mencione el tema no basta: «envío gratis» no dice cuánto tarda el envío. Si el cliente dio la medida de OTRA entrada que el workflow no atendió, dile qué tamaño le corresponde y su precio. " +
    `Si ninguno trae algo así (un saludo, un "gracias", algo que el workflow ya contestó o una nota de voz sin contenido útil no necesitan respuesta aparte), escribe exactamente ${NOTHING_TOKEN} y nada más; las acciones internas (detalle, etapa, avisos) sí puedes usarlas.`
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
export function dropClosingQuestion(text: string): string | null {
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
