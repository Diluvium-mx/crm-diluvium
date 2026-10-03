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
 * (para el registro). Si al quitarlo no queda nada que mandar, devuelve las burbujas sin cambios.
 */
export function withoutUnansweredRepeat(bubbles: readonly string[], lastAsked: string | null): { keep: string[]; dropped: string[] } {
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
  return keep.length ? { keep, dropped } : { keep: [...bubbles], dropped: [] };
}
