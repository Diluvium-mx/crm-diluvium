// Persistencia del uso y costo por llamada al modelo (PASO 4). Cada llamada del
// runtime (filtro y cerebro, incluidas las regeneraciones descartadas) deja una
// fila en ai_usage con su costo calculado al momento.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiModelPrices, aiUsage } from "@/lib/db/schema";
import { computeCostUsd, resolveModelPrice } from "@/lib/ai/pricing";
import type { ModelUsage, ProviderId } from "@/lib/ai/types";

export type UsageStage = "filtro" | "cerebro";
// Qué pasó con la llamada. "passed" = el filtro dejó pasar al cerebro.
export type UsageOutcome = "passed" | "sent" | "draft" | "discarded_stale" | "skipped" | "handover" | "error";
// Resultados finales: si el último entrante ya tiene uno, no se vuelve a atender.
export const FINAL_OUTCOMES: readonly UsageOutcome[] = ["sent", "draft", "skipped", "handover"];
// Respuestas del agente que cuentan para el freno anti-bucle y el tope por contacto.
export const REPLY_OUTCOMES: readonly UsageOutcome[] = ["sent", "draft"];

export type UsageRecord = {
  organizationId: string;
  conversationId: string;
  messageId: string | null;
  stage: UsageStage;
  modelId: string;
  provider: ProviderId;
  usage: ModelUsage | null;
  latencyMs: number;
  filterDecision?: string | null;
  outcome: UsageOutcome;
  error?: string | null;
};

// Precio efectivo del modelo para la organización: la fila de ai_model_prices
// (editable sin redeploy) o el default del código.
export async function effectivePrice(organizationId: string, modelId: string, provider: ProviderId) {
  const [row] = await db
    .select()
    .from(aiModelPrices)
    .where(and(eq(aiModelPrices.organizationId, organizationId), eq(aiModelPrices.modelId, modelId)))
    .limit(1);
  return resolveModelPrice(
    modelId,
    provider,
    row
      ? {
          inputPerMTok: row.inputPerMTok,
          outputPerMTok: row.outputPerMTok,
          cacheReadPerMTok: row.cacheReadPerMTok,
          cacheWritePerMTok: row.cacheWritePerMTok,
        }
      : null,
  );
}

// Guarda la fila. Un fallo al registrar el uso NO debe tumbar la respuesta al
// cliente: se registra en el log y se sigue (la llamada ya se hizo y cobró).
export async function recordAiUsage(r: UsageRecord): Promise<void> {
  try {
    const price = await effectivePrice(r.organizationId, r.modelId, r.provider);
    const usage = r.usage ?? { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
    await db.insert(aiUsage).values({
      id: crypto.randomUUID(),
      organizationId: r.organizationId,
      conversationId: r.conversationId,
      messageId: r.messageId,
      stage: r.stage,
      provider: r.provider,
      modelId: r.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      latencyMs: Math.round(r.latencyMs),
      costUsd: computeCostUsd(usage, price),
      filterDecision: r.filterDecision ?? null,
      outcome: r.outcome,
      error: r.error ? r.error.slice(0, 2000) : null,
      // Mismo reloj (JS, UTC) con el que el anti-bucle y el tope de gasto cuentan
      // "la última hora": no depende de la zona horaria de la sesión de Postgres.
      createdAt: new Date(),
    });
  } catch (error) {
    console.error(`[agente] no se pudo registrar ai_usage (${r.stage}/${r.outcome})`, error);
  }
}
