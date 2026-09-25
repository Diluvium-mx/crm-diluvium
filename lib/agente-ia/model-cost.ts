// Costo APROXIMADO de cada modelo para el selector de la pestaña Agente IA:
// "≈ US$1.60 por cada 100 conversaciones". PURO (sin DB): recibe los totales de
// ai_usage que lee model-cost-store.ts y multiplica por el precio de cada modelo
// (lib/ai/pricing.ts, con la sobrescritura de la organización si existe).
//
// Perfil = promedio de tokens por RESPUESTA (fila de ai_usage del cerebro con uso
// reportado: entrada total, caché leída/escrita y salida) y de respuestas por
// conversación, de los últimos 30 días de la organización. Con menos de
// MIN_REAL_RESPONSES respuestas se usa FIXED_PROFILE.
import { computeCostUsd, type ModelPrice } from "@/lib/ai/pricing";
import { formatUsd } from "@/lib/usd-format";

export const COST_WINDOW_DAYS = 30;
export const MIN_REAL_RESPONSES = 20;

export type UsageProfile = {
  // Por respuesta. inputTokens es el TOTAL de entrada e incluye la caché (mismo
  // contrato que ModelUsage / computeCostUsd).
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  responsesPerConversation: number;
};

// Perfil fijo (menos de 20 respuestas registradas), estimado con lo que el agente
// manda hoy en cada respuesta:
// - System ≈ 9,000 tokens: Goal + FAQs de Ángela (docs/agente-ia/angela-goal.md +
//   angela-faqs.json ≈ 30.7k caracteres ≈ 8,000 tokens) + ~12 herramientas
//   (≈ 60–120 tokens cada una, docs/fase-d-diseno.md) ≈ 1,000. Casi siempre se lee
//   de caché.
// - Historial + mensaje nuevo sin caché ≈ 1,500 tokens.
// - Escritura de caché ≈ 1,000 por respuesta en promedio (supuesto: 1 de cada 9
//   respuestas vuelve a escribir el system).
// - Salida ≈ 250 tokens (tope BRAIN_MAX_OUTPUT_TOKENS = 1,024).
// - 6 respuestas por conversación.
export const FIXED_PROFILE: UsageProfile = {
  inputTokens: 11_500,
  cacheReadTokens: 9_000,
  cacheWriteTokens: 1_000,
  outputTokens: 250,
  responsesPerConversation: 6,
};

export type UsageTotals = {
  responses: number;
  conversations: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type CostBasis = { source: "real" | "fijo"; responses: number };

export function usageProfile(t: UsageTotals): { profile: UsageProfile; basis: CostBasis } {
  if (t.responses < MIN_REAL_RESPONSES || t.conversations <= 0) {
    return { profile: FIXED_PROFILE, basis: { source: "fijo", responses: t.responses } };
  }
  return {
    profile: {
      inputTokens: t.inputTokens / t.responses,
      cacheReadTokens: t.cacheReadTokens / t.responses,
      cacheWriteTokens: t.cacheWriteTokens / t.responses,
      outputTokens: t.outputTokens / t.responses,
      responsesPerConversation: t.responses / t.conversations,
    },
    basis: { source: "real", responses: t.responses },
  };
}

// USD por cada 100 conversaciones con este precio; null = modelo sin precio.
export function costPer100Conversations(profile: UsageProfile, price: ModelPrice | null): number | null {
  const perResponse = computeCostUsd(
    {
      inputTokens: profile.inputTokens,
      cacheReadTokens: profile.cacheReadTokens,
      cacheWriteTokens: profile.cacheWriteTokens,
      outputTokens: profile.outputTokens,
    },
    price,
  );
  if (perResponse === null) return null;
  return perResponse * profile.responsesPerConversation * 100;
}

/** "≈ US$1.60 por cada 100 conversaciones" · "costo sin dato". */
export function costPer100Label(usd: number | null): string {
  if (usd === null) return "costo sin dato";
  if (usd < 0.005) return "≈ menos de US$0.01 por cada 100 conversaciones";
  return `≈ ${formatUsd(usd)} por cada 100 conversaciones`;
}
