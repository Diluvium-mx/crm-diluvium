// Editor del agente (pestaña "Agente IA" estilo GHL, 24-sep-2026). PURO y seguro
// para el cliente: valores personalizados, contadores del Goal, indicador de costo
// de los modelos y validación de lo que se guarda.
import { z } from "zod";

// Valores personalizados que se insertan en el Goal o en las FAQs. El runtime los
// sustituye por los datos de cada conversación antes de llamar al cerebro.
export const CUSTOM_VALUES = [
  { token: "{{contacto.nombre}}", label: "Nombre del contacto" },
  { token: "{{vendedor.nombre}}", label: "Nombre del vendedor" },
  { token: "{{empresa.nombre}}", label: "Nombre de la empresa" },
  { token: "{{agente.nombre}}", label: "Nombre del agente" },
] as const;

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

// Indicador de costo ($ a $$$$) por el precio de SALIDA en USD por millón de tokens
// (lo que más pesa en una respuesta). null = sin precio conocido.
export function costTier(outputPerMTok: number | null | undefined): 1 | 2 | 3 | 4 | null {
  if (outputPerMTok === null || outputPerMTok === undefined) return null;
  if (outputPerMTok <= 2) return 1;
  if (outputPerMTok <= 6) return 2;
  if (outputPerMTok <= 12) return 3;
  return 4;
}

export const MAX_GOAL_CHARS = 100_000;

export const goalSchema = z.string().trim().min(1, "El Goal no puede quedar vacío.").max(MAX_GOAL_CHARS, "El Goal es demasiado largo.");

export const faqSchema = z.object({
  question: z.string().trim().min(1, "Falta la pregunta.").max(1_000, "La pregunta es demasiado larga."),
  answer: z.string().trim().min(1, "Falta la respuesta.").max(10_000, "La respuesta es demasiado larga."),
  enabled: z.boolean().default(true),
});

export const profileSchema = z.object({
  agentName: z.string().trim().min(1, "El agente necesita un nombre.").max(60, "Máximo 60 caracteres."),
  companyName: z.string().trim().max(120, "Máximo 120 caracteres."),
});
