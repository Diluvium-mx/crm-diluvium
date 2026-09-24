// Gasto de IA del Dashboard (solo owner/admin, 24-sep-2026): el gasto del MES
// (días locales de Mazatlán) por proveedor y un SALDO ESTIMADO por proveedor =
// crédito cargado − gasto desde la primera recarga registrada. Ni OpenAI ni
// Anthropic dan el saldo por API (docs/investigacion/gasto-ia-saldo.md): el gasto
// sale de ai_usage.cost_usd (precios internos de lib/ai/pricing.ts).
import { sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { PROVIDER_META } from "@/lib/ai/provider";
import type { ProviderId } from "@/lib/ai/types";
import { DASHBOARD_TIME_ZONE, localToday } from "./range";

type Database = Pick<typeof appDb, "execute">;

// Siempre se muestran estos (los que el agente usa hoy); otros aparecen si gastan o
// tienen recargas.
const ALWAYS: readonly ProviderId[] = ["openai", "anthropic"];

export type ProviderSpend = {
  provider: string;
  label: string;
  monthUsd: number;
  // null = sin recargas registradas (no hay saldo que estimar).
  loadedUsd: number | null;
  firstTopupOn: string | null;
  spentSinceFirstUsd: number | null;
  balanceUsd: number | null;
};

export type TopupRow = { id: string; provider: string; label: string; amountUsd: number; toppedUpOn: string; author: string | null };

export type AiSpendSummary = { monthLabel: string; providers: ProviderSpend[]; topups: TopupRow[] };

const tz = DASHBOARD_TIME_ZONE;

export function providerLabel(provider: string): string {
  return PROVIDER_META[provider as ProviderId]?.label ?? provider;
}

// Saldo estimado: lo cargado menos lo gastado desde la primera recarga.
export function estimateBalance(loadedUsd: number, spentSinceFirstUsd: number): number {
  return Math.round((loadedUsd - spentSinceFirstUsd) * 100) / 100;
}

export async function aiSpendSummary(database: Database, organizationId: string, now: Date = new Date()): Promise<AiSpendSummary> {
  const today = localToday(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const month = await database.execute<{ provider: string; usd: string | null }>(sql`
    select provider, sum(cost_usd)::text as usd
    from ai_usage
    where organization_id = ${organizationId}
      and created_at >= (((${monthStart}::date)::timestamp at time zone ${tz}) at time zone 'UTC')
      and created_at < ((((${monthStart}::date + interval '1 month')::date)::timestamp at time zone ${tz}) at time zone 'UTC')
    group by provider
  `);
  const loads = await database.execute<{ provider: string; loaded: string; first: string; spent: string | null }>(sql`
    with t as (
      select provider, sum(amount_usd) as loaded, min(topped_up_on) as first
      from ai_credit_topups
      where organization_id = ${organizationId}
      group by provider
    )
    select t.provider, t.loaded::text as loaded, to_char(t.first, 'YYYY-MM-DD') as first,
      (select sum(u.cost_usd) from ai_usage u
        where u.organization_id = ${organizationId} and u.provider = t.provider
          and u.created_at >= (((t.first)::timestamp at time zone ${tz}) at time zone 'UTC'))::text as spent
    from t
  `);
  const topups = await database.execute<{ id: string; provider: string; amount: string; day: string; author: string | null }>(sql`
    select tp.id, tp.provider, tp.amount_usd::text as amount, to_char(tp.topped_up_on, 'YYYY-MM-DD') as day, u.name as author
    from ai_credit_topups tp
    left join "user" u on u.id = tp.created_by_user_id
    where tp.organization_id = ${organizationId}
    order by tp.topped_up_on desc, tp.created_at desc
    limit 20
  `);

  const monthBy = new Map(month.map((r) => [r.provider, Number(r.usd ?? 0)]));
  const loadBy = new Map(loads.map((r) => [r.provider, r]));
  const providers = [...new Set<string>([...ALWAYS, ...monthBy.keys(), ...loadBy.keys()])];
  return {
    monthLabel: new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T12:00:00Z`)),
    providers: providers.map((provider) => {
      const load = loadBy.get(provider);
      const loadedUsd = load ? Number(load.loaded) : null;
      const spentSinceFirstUsd = load ? Number(load.spent ?? 0) : null;
      return {
        provider,
        label: providerLabel(provider),
        monthUsd: monthBy.get(provider) ?? 0,
        loadedUsd,
        firstTopupOn: load?.first ?? null,
        spentSinceFirstUsd,
        balanceUsd: loadedUsd === null ? null : estimateBalance(loadedUsd, spentSinceFirstUsd ?? 0),
      };
    }),
    topups: topups.map((t) => ({
      id: t.id,
      provider: t.provider,
      label: providerLabel(t.provider),
      amountUsd: Number(t.amount),
      toppedUpOn: t.day,
      author: t.author,
    })),
  };
}
