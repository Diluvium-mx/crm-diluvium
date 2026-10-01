// Gasto REAL de OpenAI con la llave de administración (OPENAI_ADMIN_KEY): GET
// /v1/organization/costs, en USD por día UTC (incluye el día en curso, aunque OpenAI no dice
// con cuánto atraso). Todo en un solo proyecto ("Default project"): OpenAI no separa
// producción de pruebas; eso lo hace el Dashboard con el registro del CRM. No hay API del
// saldo: el saldo es recargas − este gasto (lib/dashboard/ai-spend.ts).
import { z } from "zod";
import type { BillingDays } from "@/lib/db/schema/ai-billing";
import { addDays, addToDay, dayStartIso, utcDay } from "./days";
import { getJson } from "./http";
import type { BillingReading, ReadOptions } from "./types";

const URL_COSTS = "https://api.openai.com/v1/organization/costs";
export const OPENAI_REFRESH_DAYS = 7;

const costsSchema = z.object({
  data: z.array(
    z.object({
      start_time: z.number(),
      results: z.array(z.object({ amount: z.object({ value: z.number() }).nullish() })),
    }),
  ),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

export async function readOpenAiBilling(adminKey: string, opts: ReadOptions): Promise<BillingReading> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const today = utcDay(opts.now);
  const refreshFrom = addDays(today, -OPENAI_REFRESH_DAYS);
  const replaceFrom = opts.hasHistory && opts.fromDay < refreshFrom ? refreshFrom : opts.fromDay;
  const days: BillingDays = {};
  const startTime = Math.floor(new Date(dayStartIso(replaceFrom)).getTime() / 1000);
  let page: string | null | undefined;
  do {
    const q = new URLSearchParams({ start_time: String(startTime), bucket_width: "1d", limit: "180" });
    if (page) q.set("page", page);
    const r = costsSchema.parse(await getJson(fetchImpl, `${URL_COSTS}?${q}`, { Authorization: `Bearer ${adminKey}` }));
    for (const b of r.data) {
      const day = utcDay(new Date(b.start_time * 1000));
      for (const row of b.results) if (row.amount) addToDay(days, day, row.amount.value);
    }
    page = r.has_more ? r.next_page : null;
  } while (page);
  return { days, replaceFrom, balanceUsd: null, loadedUsd: null, warnings: [] };
}
