// Gasto de IA del Dashboard (todos los roles; recargas solo owner/admin): por proveedor, el gasto del MES
// (días locales de Mazatlán) y un SALDO ESTIMADO = recargas − gasto de producción
// desde la primera recarga. Ni OpenAI ni Anthropic dan el saldo por API
// (docs/investigacion/gasto-ia-saldo.md): el gasto sale de ai_usage.cost_usd
// (precios internos de lib/ai/pricing.ts). Solo cuenta el gasto de ESTE entorno:
// el de pruebas (staging) ya no se lee ni se descuenta (24-sep-2026).
import { sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { PROVIDER_META } from "@/lib/ai/provider";
import type { ProviderId } from "@/lib/ai/types";
import { DASHBOARD_TIME_ZONE, localToday } from "./range";

type Database = Pick<typeof appDb, "execute">;

// Siempre se muestran estos (los que el agente usa hoy); otros aparecen si gastan o
// tienen recargas.
const ALWAYS: readonly ProviderId[] = ["openai", "anthropic"];

// Gasto de un día local (YYYY-MM-DD, Mazatlán) de un proveedor.
export type DaySpend = { day: string; provider: string; usd: number };

export type ProviderSpend = {
  provider: string;
  label: string;
  // Gasto del mes.
  monthUsd: number;
  // null = sin recargas registradas (no hay saldo que estimar).
  loadedUsd: number | null;
  firstTopupOn: string | null;
  spentSinceFirstUsd: number | null;
  balanceUsd: number | null;
};

export type TopupRow = { id: string; provider: string; label: string; amountUsd: number; toppedUpOn: string; author: string | null };

export type AiSpendSummary = {
  monthLabel: string;
  providers: ProviderSpend[];
  topups: TopupRow[];
};

const tz = DASHBOARD_TIME_ZONE;

export function providerLabel(provider: string): string {
  return PROVIDER_META[provider as ProviderId]?.label ?? provider;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Saldo estimado: lo cargado menos lo gastado desde la primera recarga.
export function estimateBalance(loadedUsd: number, spentSinceFirstUsd: number): number {
  return cents(loadedUsd - spentSinceFirstUsd);
}

function sumDays(days: readonly DaySpend[], provider: string, from: string, toExclusive?: string): number {
  let total = 0;
  for (const d of days) {
    if (d.provider === provider && d.day >= from && (toExclusive === undefined || d.day < toExclusive)) total += d.usd;
  }
  return total;
}

function nextMonthStart(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

// Día desde el que hay que traer gasto: el inicio del mes o la primera recarga, lo
// que sea anterior.
export function spendFrom(monthStart: string, firstTopups: readonly string[]): string {
  return [monthStart, ...firstTopups].sort()[0];
}

type Load = { provider: string; loadedUsd: number; firstTopupOn: string };

// PURO: arma los números de cada proveedor a partir del gasto diario y las recargas.
// `connected` (Fase E): proveedores con su llave en el servidor; salen aunque aún no
// tengan gasto (el dueño les cargó saldo y quiere verlos). Orden fijo: el de PROVIDER_META.
export function summarizeProviders(input: {
  monthStart: string;
  days: readonly DaySpend[];
  loads: readonly Load[];
  connected?: readonly string[];
}): ProviderSpend[] {
  const monthEnd = nextMonthStart(input.monthStart);
  const loadBy = new Map(input.loads.map((l) => [l.provider, l]));
  const seen = new Set<string>([...ALWAYS, ...(input.connected ?? [])]);
  for (const d of input.days) seen.add(d.provider);
  for (const l of input.loads) seen.add(l.provider);
  const order = Object.keys(PROVIDER_META);
  const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);
  return [...seen].sort((a, b) => rank(a) - rank(b)).map((provider) => {
    const load = loadBy.get(provider);
    const spent = load ? sumDays(input.days, provider, load.firstTopupOn) : null;
    return {
      provider,
      label: providerLabel(provider),
      monthUsd: sumDays(input.days, provider, input.monthStart, monthEnd),
      loadedUsd: load ? load.loadedUsd : null,
      firstTopupOn: load?.firstTopupOn ?? null,
      spentSinceFirstUsd: spent,
      balanceUsd: load ? estimateBalance(load.loadedUsd, spent ?? 0) : null,
    };
  });
}

// Gasto por día LOCAL (Mazatlán) y proveedor de la organización desde `from` (inclusive).
export async function spendByDay(database: Database, organizationId: string, from: string): Promise<DaySpend[]> {
  const rows = await database.execute<{ day: string; provider: string; usd: string | null }>(sql`
    select to_char((created_at at time zone 'UTC') at time zone ${tz}, 'YYYY-MM-DD') as day,
      provider, sum(cost_usd)::text as usd
    from ai_usage
    where created_at >= (((${from}::date)::timestamp at time zone ${tz}) at time zone 'UTC')
      and organization_id = ${organizationId}
    group by 1, 2
    order by 1, 2
  `);
  return rows.map((r) => ({ day: r.day, provider: r.provider, usd: Number(r.usd ?? 0) }));
}

export async function aiSpendSummary(database: Database, organizationId: string, options: { now?: Date } = {}): Promise<AiSpendSummary> {
  const today = localToday(options.now ?? new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const loadRows = await database.execute<{ provider: string; loaded: string; first: string }>(sql`
    select provider, sum(amount_usd)::text as loaded, to_char(min(topped_up_on), 'YYYY-MM-DD') as first
    from ai_credit_topups
    where organization_id = ${organizationId}
    group by provider
  `);
  const loads: Load[] = loadRows.map((r) => ({ provider: r.provider, loadedUsd: Number(r.loaded), firstTopupOn: r.first }));
  const days = await spendByDay(database, organizationId, spendFrom(monthStart, loads.map((l) => l.firstTopupOn)));

  const topups = await database.execute<{ id: string; provider: string; amount: string; day: string; author: string | null }>(sql`
    select tp.id, tp.provider, tp.amount_usd::text as amount, to_char(tp.topped_up_on, 'YYYY-MM-DD') as day, u.name as author
    from ai_credit_topups tp
    left join "user" u on u.id = tp.created_by_user_id
    where tp.organization_id = ${organizationId}
    order by tp.topped_up_on desc, tp.created_at desc
    limit 20
  `);

  return {
    monthLabel: new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T12:00:00Z`)),
    providers: summarizeProviders({
      monthStart,
      days,
      loads,
      // Solo si la variable de la llave EXISTE en el servidor (nunca su valor).
      connected: Object.values(PROVIDER_META).filter((m) => Boolean(process.env[m.envKey])).map((m) => m.id),
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
