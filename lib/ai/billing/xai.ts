// Saldo y gasto REALES de xAI con la llave de administración (XAI_MANAGEMENT_KEY, permiso
// solo "Billing: Read only") y el ID de equipo (XAI_TEAM_ID): GET
// /v1/billing/teams/{team}/prepaid/balance. Ojo con el signo (documentado por xAI): las
// compras vienen NEGATIVAS y el gasto POSITIVO, en centavos de dólar como texto; el saldo es
// −total. Un tercero dice que xAI descuenta el gasto con retraso (sin confirmar): por eso el
// Dashboard nunca muestra más saldo que lo comprado − lo que registró el CRM.
import { z } from "zod";
import type { BillingDays } from "@/lib/db/schema/ai-billing";
import { addToDay, round8, utcDay } from "./days";
import { getJson } from "./http";
import type { BillingReading, ReadOptions } from "./types";

const balanceSchema = z.object({
  changes: z
    .array(
      z.object({
        changeOrigin: z.string().nullish(),
        amount: z.object({ val: z.string() }).nullish(),
        createTime: z.string().nullish(),
        topupStatus: z.string().nullish(),
      }),
    )
    .nullish(),
  total: z.object({ val: z.string() }),
});

// Compras que no cuentan como saldo cargado.
const FAILED_TOPUP = /FAIL|CANCEL|PENDING/i;

export async function readXaiBilling(managementKey: string, teamId: string, opts: ReadOptions): Promise<BillingReading> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`;
  const r = balanceSchema.parse(await getJson(fetchImpl, url, { Authorization: `Bearer ${managementKey}` }));
  const days: BillingDays = {};
  let loaded = 0;
  let earliest = utcDay(opts.now);
  for (const c of r.changes ?? []) {
    const cents = Number(c.amount?.val ?? 0);
    if (!Number.isFinite(cents) || cents === 0) continue;
    if (cents < 0) {
      if (!c.topupStatus || !FAILED_TOPUP.test(c.topupStatus)) loaded += -cents / 100;
      continue;
    }
    if (!c.createTime) continue;
    const day = c.createTime.slice(0, 10);
    if (day < earliest) earliest = day;
    addToDay(days, day, cents / 100);
  }
  return {
    days,
    // xAI manda el historial completo: desde su primer gasto, lo guardado se sustituye.
    replaceFrom: earliest,
    balanceUsd: round8(-Number(r.total.val) / 100),
    loadedUsd: round8(loaded),
    warnings: [],
  };
}
