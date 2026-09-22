// Ensamblador del system del "cerebro" (Fase B). PURO: sin imports de servidor,
// DB ni SDK, para poder testearlo y contar sus tokens sin entorno. El system =
// Goal (ai_config.goal) + bloque de FAQs (ai_knowledge) en formato "P: … / R: …".
// El cacheControl ephemeral NO se pone aquí: lo aplica el adaptador Anthropic al
// bloque `system` (lib/ai/providers/anthropic.ts). Aquí solo se arma el texto.

export type Faq = {
  question: string;
  answer: string;
  position: number;
  // Ausente = habilitada. Una FAQ deshabilitada no entra al system.
  enabled?: boolean;
};

// Encabezado del bloque de conocimiento. El Goal ya se refiere a "la base de
// conocimiento"; usamos ese mismo término para que el modelo distinga el Goal
// (comportamiento) de las FAQs (información factual del producto).
export const FAQ_SECTION_HEADER = "BASE DE CONOCIMIENTO (PREGUNTAS FRECUENTES)";

// Arma el bloque de FAQs: solo habilitadas, ordenadas por posición, cada una
// como "P: <pregunta>\nR: <respuesta>", separadas por una línea en blanco.
export function buildFaqBlock(faqs: readonly Faq[]): string {
  return faqs
    .filter((f) => f.enabled !== false)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((f) => `P: ${f.question.trim()}\nR: ${f.answer.trim()}`)
    .join("\n\n");
}

// System completo del cerebro: Goal, luego el encabezado y el bloque de FAQs.
// Si no hay FAQs habilitadas, devuelve solo el Goal (el cerebro aún funciona con
// el Goal, aunque sin base de conocimiento).
export function buildBrainSystem(goal: string, faqs: readonly Faq[]): string {
  const block = buildFaqBlock(faqs);
  const base = goal.trim();
  if (!block) return base;
  return `${base}\n\n${FAQ_SECTION_HEADER}\n\n${block}`;
}
