// Saldo y gasto REALES de OpenRouter con la llave de administración (OPENROUTER_MANAGEMENT_KEY;
// no puede usar modelos): /api/v1/credits da lo comprado y lo usado al momento (saldo exacto) y
// /api/v1/activity el gasto por día UTC de los últimos 30 días COMPLETOS (el de hoy aún no).
import { z } from "zod";
import type { BillingDays } from "@/lib/db/schema/ai-billing";
import { addDays, addToDay, round8, utcDay } from "./days";
import { getJson } from "./http";
import type { BillingReading, ReadOptions } from "./types";

const BASE = "https://openrouter.ai/api/v1";

const creditsSchema = z.object({ data: z.object({ total_credits: z.number(), total_usage: z.number() }) });
const activitySchema = z.object({ data: z.array(z.object({ date: z.string(), usage: z.number().nullish() })) });

export async function readOpenRouterBilling(managementKey: string, opts: ReadOptions): Promise<BillingReading> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const auth = { Authorization: `Bearer ${managementKey}` };
  const credits = creditsSchema.parse(await getJson(fetchImpl, `${BASE}/credits`, auth)).data;
  const activity = activitySchema.parse(await getJson(fetchImpl, `${BASE}/activity`, auth)).data;
  const days: BillingDays = {};
  // "2026-09-25 00:00:00" → día UTC.
  for (const row of activity) if (row.usage) addToDay(days, row.date.slice(0, 10), row.usage);
  return {
    days,
    replaceFrom: addDays(utcDay(opts.now), -30),
    balanceUsd: round8(credits.total_credits - credits.total_usage),
    loadedUsd: round8(credits.total_credits),
    warnings: [],
  };
}
