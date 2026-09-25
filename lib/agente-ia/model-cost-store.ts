import "server-only";
// Lecturas (solo lectura) para el costo aproximado de cada modelo del selector:
// totales de uso del cerebro en los últimos 30 días y los precios sobrescritos por
// la organización. Toda consulta filtra por organization_id.
import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiModelPrices, aiUsage } from "@/lib/db/schema";
import type { PriceOverride } from "@/lib/ai/pricing";
import { COST_WINDOW_DAYS, type UsageTotals } from "./model-cost";

export async function brainUsageTotals(organizationId: string, now: Date = new Date()): Promise<UsageTotals> {
  // ai_usage.created_at se escribe con el reloj de JS (UTC): se compara igual.
  const since = new Date(now.getTime() - COST_WINDOW_DAYS * 86_400_000);
  const [row] = await db
    .select({
      responses: sql<number>`count(*)::int`,
      conversations: sql<number>`count(distinct ${aiUsage.conversationId})::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::float8`,
      cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::float8`,
      cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::float8`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(aiUsage.stage, "cerebro"),
        gte(aiUsage.createdAt, since),
        // Solo llamadas con uso reportado (un error sin tokens no es una respuesta).
        or(isNotNull(aiUsage.inputTokens), isNotNull(aiUsage.outputTokens)),
      ),
    );
  return {
    responses: Number(row?.responses ?? 0),
    conversations: Number(row?.conversations ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    cacheReadTokens: Number(row?.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row?.cacheWriteTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
  };
}

// Precios sobrescritos por la organización (ai_model_prices), por id de modelo.
export async function priceOverrides(organizationId: string): Promise<Record<string, PriceOverride>> {
  const rows = await db.select().from(aiModelPrices).where(eq(aiModelPrices.organizationId, organizationId));
  return Object.fromEntries(
    rows.map((r) => [
      r.modelId,
      {
        inputPerMTok: r.inputPerMTok,
        outputPerMTok: r.outputPerMTok,
        cacheReadPerMTok: r.cacheReadPerMTok,
        cacheWritePerMTok: r.cacheWritePerMTok,
      },
    ]),
  );
}
