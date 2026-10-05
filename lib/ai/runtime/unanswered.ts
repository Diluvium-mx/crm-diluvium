// Pregunta sin contestar (3-oct-2026, dueño). PURO (sin BD).
//
// Caso: un workflow o el Agente IA preguntó («¿Usted tiene problemas de inundaciones?»), el
// cliente no contestó y preguntó otra cosa («¿En dónde están ubicados?»). El Agente IA contestaba
// su duda y volvía a hacer la MISMA pregunta, palabra por palabra (44 veces en 40 chats del 30-sep
// al 3-oct). El candado anti-repetición (lib/messaging/repeat.ts) no lo veía porque solo compara
// contra lo que salió DESPUÉS del último mensaje del cliente.
//
// Regla: si una burbuja del Agente IA es IDÉNTICA al último mensaje con pregunta que le salió al
// cliente, o termina con la MISMA pregunta final, esa pregunta no sale; sale el resto. Si no queda nada (p. ej. el cliente solo dijo
// «ok» y el Agente IA solo vuelve a preguntar), sale tal cual: el chat nunca se queda sin
// respuesta. Va junto con la sección PREGUNTA SIN CONTESTAR del Goal.
//
// 5-oct-2026: ese escape dejó salir 3 veces la pregunta sola, idéntica («Quiero más información» otra
// vez; «ha estado lloviendo mucho»). Ahora, si la respuesta era SOLO la pregunta repetida, run.ts pide
// otra respuesta con `repeatNote` y, si tampoco, no sale nada y el vendedor recibe el aviso
// amarillo. Solo un acuse del cliente (`isBareAck`) deja volver a hacerla.
import { repeatKey } from "@/lib/messaging/repeat";
import { dropClosingQuestion } from "./complement";

/** La pregunta con que termina un texto (sin espacios de más), o null si no termina en pregunta. */
export function closingQuestion(text: string): string | null {
  const t = text.trim();
  const cut = dropClosingQuestion(t);
  return cut === null ? null : t.slice(cut.length).trim() || null;
}

/** ¿El texto pregunta algo? (tiene «?» en algún lado: «¿Habrá manera de medir…? De izquierda a derecha…»). */
export function asksSomething(text: string): boolean {
  return text.includes("?");
}

/**
 * Quita lo que repite la última pregunta que se le hizo al cliente. `lastAsked` = el último
 * mensaje que le salió con pregunta. Una burbuja IDÉNTICA a ese mensaje no sale; de una burbuja
 * que termina con la MISMA pregunta final se quita solo la pregunta. `dropped`: lo que no sale
 * (para el registro). Sin la salida de "nunca silencio": `keep` puede quedar vacío.
 */
function stripRepeat(bubbles: readonly string[], lastAsked: string | null): { keep: string[]; dropped: string[] } {
  const whole = lastAsked ? repeatKey(lastAsked) : "";
  if (!whole) return { keep: [...bubbles], dropped: [] };
  const finalQuestion = closingQuestion(lastAsked!);
  const questionKey = finalQuestion ? repeatKey(finalQuestion) : "";
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const bubble of bubbles) {
    if (repeatKey(bubble) === whole) {
      dropped.push(bubble.trim());
      continue;
    }
    const question = closingQuestion(bubble);
    if (!questionKey || question === null || repeatKey(question) !== questionKey) {
      keep.push(bubble);
      continue;
    }
    dropped.push(question);
    const rest = dropClosingQuestion(bubble.trim()) ?? "";
    if (/[\p{L}\p{N}]/u.test(rest)) keep.push(rest);
  }
  return { keep, dropped };
}

/**
 * Lo que sale: sin la pregunta repetida. Si al quitarla no queda nada, devuelve las burbujas sin
 * cambios; ese caso (la respuesta era SOLO la pregunta repetida) lo resuelve antes run.ts con
 * `onlyRepeatsLastQuestion` (5-oct-2026): pide otra respuesta o avisa al vendedor, y solo deja
 * salir la pregunta si el cliente mandó un acuse («ok», «gracias», 👍…).
 */
export function withoutUnansweredRepeat(bubbles: readonly string[], lastAsked: string | null): { keep: string[]; dropped: string[] } {
  const r = stripRepeat(bubbles, lastAsked);
  return r.keep.length ? r : { keep: [...bubbles], dropped: [] };
}

/** ¿La respuesta es SOLO la pregunta que ya se le hizo al cliente (nada más que decirle)? */
export function onlyRepeatsLastQuestion(bubbles: readonly string[], lastAsked: string | null): boolean {
  if (!bubbles.some((b) => /[\p{L}\p{N}]/u.test(b))) return false;
  const r = stripRepeat(bubbles, lastAsked);
  return r.keep.length === 0 && r.dropped.length > 0;
}

// Acuse puro del cliente: «ok», «va», «gracias», un emoji o un sticker. Ahí volver a hacer la
// pregunta pendiente es lo correcto (Goal, PREGUNTA SIN CONTESTAR: «vuelve a ella cuando el
// cliente ya no esté haciendo dudas»). «Sí» NO es acuse: puede ser la respuesta a la pregunta.
const ACK_WORDS = /^(ok|oka|okey|okay|oki|okis|ok\s+gracias|va|vale|sale|sale\s+gracias|gracias|muchas\s+gracias|mil\s+gracias|perfecto|perfecto\s+gracias|de\s+acuerdo|entendido|enterado|listo|bien|muy\s+bien|excelente|gracias\s+por\s+la\s+informaci[oó]n)$/u;
export function isBareAck(message: { body: string | null; attachments: readonly { type: string }[] }): boolean {
  const others = message.attachments.filter((a) => a.type !== "sticker");
  if (others.length) return false;
  const text = (message.body ?? "").normalize("NFC").toLocaleLowerCase("es-MX").replace(/[\s.,;:!¡¿?…]+/gu, " ").trim();
  if (!text) return message.attachments.length > 0; // solo un sticker
  if (!/[\p{L}\p{N}]/u.test(text)) return true; // solo emojis
  return ACK_WORDS.test(text.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim());
}

/** Nota para pedir otra respuesta cuando la primera solo repetía la pregunta (run.ts). */
export function repeatNote(question: string): string {
  return `Tu respuesta solo volvía a hacer la pregunta «${question.trim()}», que ya se le hizo al cliente y está arriba en la conversación. No la repitas: si el cliente ya la contestó, aunque sea de forma indirecta, toma su respuesta y pasa al siguiente dato que falte; si volvió a pedir información que ya recibió, explícale algo que todavía no sepa, sin pregunta; si escribió otra cosa, contéstale eso.`;
}
