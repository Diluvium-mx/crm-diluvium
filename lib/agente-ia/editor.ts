// Editor del agente (pestaña "Agente IA" estilo GHL, 24-sep-2026). PURO y seguro
// para el cliente: valores personalizados (sustitución), contadores del Goal, indicador de costo
// de los modelos y validación de lo que se guarda.
import { z } from "zod";

// Valores personalizados ({{contacto.nombre}}, {{vendedor.nombre}}, {{empresa.nombre}},
// {{agente.nombre}}) escritos a mano en el Goal o en las FAQs: el runtime los sustituye por
// los datos de cada conversación antes de llamar al cerebro. El botón que los insertaba se
// quitó el 28-sep-2026 (las copias del Goal de producción no usan ninguno); la sustitución se queda
// para que uno escrito a mano nunca le llegue al modelo con las llaves.
export type CustomValues = { contacto: string; vendedor: string; empresa: string; agente: string };

// Sustituye los valores (tolera espacios y mayúsculas dentro de las llaves).
export function applyCustomValues(text: string, values: CustomValues): string {
  return text.replace(/\{\{\s*(contacto|vendedor|empresa|agente)\s*\.\s*nombre\s*\}\}/giu, (_m, key: string) => {
    const k = key.toLowerCase() as keyof CustomValues;
    return values[k];
  });
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/u).length : 0;
}

// Tokens aproximados (español ≈ 3.8 caracteres por token). Solo informativo.
export function approxTokens(text: string): number {
  return Math.round(text.length / 3.8);
}

export const MAX_GOAL_CHARS = 100_000;

export const goalSchema = z.string().trim().min(1, "El Goal no puede quedar vacío.").max(MAX_GOAL_CHARS, "El Goal es demasiado largo.");

export const faqSchema = z.object({
  question: z.string().trim().min(1, "Falta la pregunta.").max(1_000, "La pregunta es demasiado larga."),
  answer: z.string().trim().min(1, "Falta la respuesta.").max(10_000, "La respuesta es demasiado larga."),
  enabled: z.boolean().default(true),
});

/**
 * Botón «Copiar» de las FAQs (28-sep-2026, pedido del dueño para revisarlas afuera):
 * TODAS, en el orden de la lista, cada una con un guion (sin números) y su respuesta
 * debajo con sangría; una línea en blanco entre preguntas. Las inactivas llevan
 * "(inactiva)" para saber que el agente no las usa.
 */
export function faqsAsText(faqs: readonly { question: string; answer: string; enabled: boolean }[]): string {
  return faqs
    .map((faq) => {
      const answer = faq.answer
        .trim()
        .split(/\r?\n/u)
        .map((line) => (line.trim() ? `  ${line.trimEnd()}` : ""))
        .join("\n");
      return `- ${faq.question.trim()}${faq.enabled ? "" : " (inactiva)"}\n${answer}`;
    })
    .join("\n\n");
}

// Cada campo se guarda por separado (el que no viene no se toca): así cambiar el
// nombre del agente nunca regresa el de la empresa a un valor viejo, ni al revés.
export const profileSchema = z
  .object({
    agentName: z.string().trim().min(1, "El agente necesita un nombre.").max(60, "Máximo 60 caracteres.").optional(),
    companyName: z.string().trim().max(120, "Máximo 120 caracteres.").optional(),
  })
  .refine((v) => v.agentName !== undefined || v.companyName !== undefined, { message: "Nada que guardar." });

// Nombre de una versión del Goal o de las FAQs (lápiz ✎, 27-sep-2026). Se recorta; vacío =
// sin nombre (null, se ve solo la fecha). Máximo 80 caracteres.
export const MAX_VERSION_NAME = 80;

export const versionNameSchema = z
  .string()
  .trim()
  .max(MAX_VERSION_NAME, `El nombre de la versión admite máximo ${MAX_VERSION_NAME} caracteres.`)
  .transform((v) => (v === "" ? null : v));

// «¿Restaurar la versión «Antes de la promo» del 26 sep 2026, 11:53 a.m.?» (sin nombre, solo la fecha).
export function restoreVersionQuestion(name: string | null, when: string): string {
  const named = name?.trim();
  return named ? `¿Restaurar la versión «${named}» del ${when}?` : `¿Restaurar la versión del ${when}?`;
}
