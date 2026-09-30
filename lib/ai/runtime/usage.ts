// Persistencia del uso y costo por llamada al modelo (PASO 4). Cada llamada del
// runtime (filtro y cerebro, incluidas las regeneraciones descartadas) deja una
// fila en ai_usage con su costo calculado al momento.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiModelPrices, aiUsage } from "@/lib/db/schema";
import { computeCostUsd, resolveModelPrice } from "@/lib/ai/pricing";
import type { ModelUsage, ProviderId } from "@/lib/ai/types";

// "transcripcion" (parte 1, 26-sep-2026): nota de voz del cliente → texto (worker).
// "detalle" (0047): el lector en segundo plano (lector.ts) deja al día etapa y Detalle.
export type UsageStage = "filtro" | "cerebro" | "transcripcion" | "detalle";
// Qué pasó con la llamada. "passed" = el filtro dejó pasar al cerebro. Las de la
// transcripción tienen sus propios resultados: no cuentan como respuesta ni como error
// del agente sobre ese mensaje (alreadyHandled y el barrido no las ven).
export type UsageOutcome =
  | "passed"
  | "sent"
  | "draft"
  | "discarded_stale"
  | "skipped"
  | "handover"
  // 27-sep-2026: el Modelo 1 contestó, pero con su respuesta el contacto pasa a una etapa
  // del Modelo 2 y esa respuesta la escribe el Modelo 2 (la del Modelo 1 no se envía).
  | "traspaso"
  // 29-sep-2026 (red contra el silencio): el modelo contestó solo con acciones, sin texto para
  // el cliente, y nadie le había contestado: escribe otro modelo (o, si ninguno, aviso al
  // vendedor). No es resultado final: el final lo deja la respuesta que sí se usó.
  | "sin_texto"
  | "error"
  | "transcrita"
  | "transcripcion_fallida"
  // Lector en segundo plano: cambió algo de la ficha, o la leyó y ya estaba al día. Van
  // SIN message_id (no cuentan como respuesta ni como error del agente sobre un mensaje).
  | "detalle_aplicado"
  | "detalle_sin_cambios";
// Resultados finales: si el último entrante ya tiene uno, no se vuelve a atender.
export const FINAL_OUTCOMES: readonly UsageOutcome[] = ["sent", "draft", "skipped", "handover"];

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
  // Costo ya calculado (la transcripción se cobra por minuto, no por token).
  costUsd?: number | null;
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
      costUsd: r.costUsd !== undefined ? r.costUsd : computeCostUsd(usage, price),
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
