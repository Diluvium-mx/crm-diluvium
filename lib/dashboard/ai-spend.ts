// Gasto de IA del Dashboard: por proveedor, el gasto del MES y el SALDO.
//
// Desde el 1-oct-2026 los números salen de cada proveedor (lib/ai/billing, leídos cada 5 min por
// el worker y guardados en ai_provider_billing), no de una estimación:
// - Gasto de cada día = lo que reporta el proveedor, y nunca menos de lo que registró el CRM ese
//   día en producción (ai_usage): así los últimos minutos que el proveedor aún no reporta ya
//   cuentan. Días UTC, igual que la consola de cada proveedor.
// - "En producción" = el registro del CRM (en Anthropic, desde el 1-oct, lo que cobró en el
//   espacio Default); "Pruebas" = el resto (en Anthropic, el espacio "Pruebas").
// - Saldo: xAI y OpenRouter lo dan directo; Anthropic y OpenAI no tienen API del saldo → recargas
//   registradas − gasto real desde la primera recarga.
// - Sin lectura del proveedor (Google, o sin llave de administración): el estimado de siempre,
//   con el registro del CRM. Detalle: docs/investigacion/gasto-ia-saldo.md.
import { sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { ANTHROPIC_PRUEBAS_DESDE } from "@/lib/ai/billing/anthropic";
import { monthStartUtc, round8 } from "@/lib/ai/billing/days";
import { PROVIDER_META } from "@/lib/ai/provider";
import type { ProviderId } from "@/lib/ai/types";
import type { BillingDay, BillingDays } from "@/lib/db/schema/ai-billing";

type Database = Pick<typeof appDb, "execute">;

// Siempre se muestran estos (los que el agente usa hoy); otros aparecen si gastan o
// tienen recargas.
const ALWAYS: readonly ProviderId[] = ["openai", "anthropic"];

// Gasto de un día UTC (YYYY-MM-DD) de un proveedor según el registro del CRM.
export type DaySpend = { day: string; provider: string; usd: number };

export type ProviderSpend = {
  provider: string;
  label: string;
  // Gasto del mes = producción + pruebas.
  monthUsd: number;
  monthProdUsd: number;
  monthTestsUsd: number;
  // "proveedor" = gasto (y saldo) leídos del proveedor; "estimado" = solo el registro del CRM.
  source: "proveedor" | "estimado";
  // Minutos desde la última lectura buena del proveedor (null si es estimado).
  updatedMinutesAgo: number | null;
  // Error del último intento de lectura (la tarjeta sigue con la lectura anterior).
  lastError: string | null;
  // null = sin recargas registradas ni saldo del proveedor (no hay saldo que mostrar).
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

// Última lectura del proveedor (fila de ai_provider_billing).
export type BillingSnapshot = {
  provider: string;
  days: BillingDays;
  balanceUsd: number | null;
  loadedUsd: number | null;
  fetchedAt: Date | null;
  lastError: string | null;
};

type Load = { provider: string; loadedUsd: number; firstTopupOn: string };

export function providerLabel(provider: string): string {
  return PROVIDER_META[provider as ProviderId]?.label ?? provider;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Saldo con recargas: lo cargado menos lo gastado desde la primera recarga.
export function estimateBalance(loadedUsd: number, spentSinceFirstUsd: number): number {
  return cents(loadedUsd - spentSinceFirstUsd);
}

function nextMonthStart(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

// Día desde el que hay que traer gasto: el inicio del mes o la primera recarga, lo que sea anterior.
export function spendFrom(monthStart: string, firstTopups: readonly string[]): string {
  return [monthStart, ...firstTopups].sort()[0];
}

// Producción y pruebas de UN día. `crm` = lo que registró el CRM ese día; `rep` = lo que reportó
// el proveedor (undefined si no hay lectura). PURO.
export function splitDay(provider: string, day: string, crm: number, rep: BillingDay | undefined): { prod: number; tests: number } {
  if (!rep) return { prod: crm, tests: 0 };
  // Anthropic separa por espacio de trabajo desde que existe "Pruebas".
  if (provider === "anthropic" && day >= ANTHROPIC_PRUEBAS_DESDE && (rep.prod !== undefined || rep.pruebas !== undefined)) {
    return { prod: Math.max(rep.prod ?? 0, crm), tests: rep.pruebas ?? 0 };
  }
  // Los demás (y Anthropic antes de "Pruebas"): lo que no registró el CRM es de pruebas.
  const total = Math.max(rep.todo, crm);
  return { prod: crm, tests: total - crm };
}

// PURO: arma los números de cada proveedor a partir del gasto diario del CRM, la última lectura
// de cada proveedor y las recargas. `connected` (Fase E): proveedores con su llave en el servidor;
// salen aunque aún no tengan gasto. Orden fijo: el de PROVIDER_META.
export function summarizeProviders(input: {
  now: Date;
  monthStart: string;
  days: readonly DaySpend[];
  loads: readonly Load[];
  billing?: readonly BillingSnapshot[];
  connected?: readonly string[];
}): ProviderSpend[] {
  const monthEnd = nextMonthStart(input.monthStart);
  const loadBy = new Map(input.loads.map((l) => [l.provider, l]));
  const billingBy = new Map((input.billing ?? []).filter((b) => b.fetchedAt).map((b) => [b.provider, b]));
  const errorBy = new Map((input.billing ?? []).map((b) => [b.provider, b.lastError]));
  const seen = new Set<string>([...ALWAYS, ...(input.connected ?? []), ...billingBy.keys()]);
  for (const d of input.days) seen.add(d.provider);
  for (const l of input.loads) seen.add(l.provider);
  const order = Object.keys(PROVIDER_META);
  const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);

  return [...seen].sort((a, b) => rank(a) - rank(b)).map((provider) => {
    const load = loadBy.get(provider);
    const snap = billingBy.get(provider);
    const from = spendFrom(input.monthStart, load ? [load.firstTopupOn] : []);
    const crmBy = new Map<string, number>();
    for (const d of input.days) if (d.provider === provider && d.day >= from) crmBy.set(d.day, (crmBy.get(d.day) ?? 0) + d.usd);
    const allDays = new Set<string>(crmBy.keys());
    for (const day of Object.keys(snap?.days ?? {})) if (day >= from) allDays.add(day);

    let monthProd = 0;
    let monthTests = 0;
    let sinceFirst = 0;
    let all = 0;
    for (const day of allDays) {
      const { prod, tests } = splitDay(provider, day, crmBy.get(day) ?? 0, snap?.days[day]);
      all += prod + tests;
      if (day >= input.monthStart && day < monthEnd) {
        monthProd += prod;
        monthTests += tests;
      }
      if (load && day >= load.firstTopupOn) sinceFirst += prod + tests;
    }

    let loadedUsd: number | null = null;
    let spentSinceFirstUsd: number | null = null;
    let balanceUsd: number | null = null;
    let firstTopupOn: string | null = null;
    if (snap && snap.balanceUsd !== null && snap.loadedUsd !== null) {
      // Saldo directo del proveedor; nunca más que lo comprado − lo que ya se sabe gastado.
      loadedUsd = cents(snap.loadedUsd);
      balanceUsd = cents(Math.min(snap.balanceUsd, snap.loadedUsd - all));
      spentSinceFirstUsd = cents(loadedUsd - balanceUsd);
    } else if (load) {
      loadedUsd = load.loadedUsd;
      firstTopupOn = load.firstTopupOn;
      spentSinceFirstUsd = round8(sinceFirst);
      balanceUsd = estimateBalance(load.loadedUsd, sinceFirst);
    }

    return {
      provider,
      label: providerLabel(provider),
      monthUsd: round8(monthProd + monthTests),
      monthProdUsd: round8(monthProd),
      monthTestsUsd: round8(monthTests),
      source: snap ? "proveedor" : "estimado",
      updatedMinutesAgo: snap?.fetchedAt ? Math.max(0, Math.floor((input.now.getTime() - snap.fetchedAt.getTime()) / 60_000)) : null,
      lastError: errorBy.get(provider) ?? null,
      loadedUsd,
      firstTopupOn,
      spentSinceFirstUsd,
      balanceUsd,
    };
  });
}

// Gasto que registró el CRM por día UTC y proveedor, de la organización, desde `from` (inclusive).
// created_at se guarda en UTC sin zona.
export async function spendByDay(database: Database, organizationId: string, from: string): Promise<DaySpend[]> {
  const rows = await database.execute<{ day: string; provider: string; usd: string | null }>(sql`
    select to_char(created_at, 'YYYY-MM-DD') as day, provider, sum(cost_usd)::text as usd
    from ai_usage
    where created_at >= ${from}::date
      and organization_id = ${organizationId}
    group by 1, 2
    order by 1, 2
  `);
  return rows.map((r) => ({ day: r.day, provider: r.provider, usd: Number(r.usd ?? 0) }));
}

export async function aiSpendSummary(database: Database, organizationId: string, options: { now?: Date } = {}): Promise<AiSpendSummary> {
  const now = options.now ?? new Date();
  const monthStart = monthStartUtc(now);
  const loadRows = await database.execute<{ provider: string; loaded: string; first: string }>(sql`
    select provider, sum(amount_usd)::text as loaded, to_char(min(topped_up_on), 'YYYY-MM-DD') as first
    from ai_credit_topups
    where organization_id = ${organizationId}
    group by provider
  `);
  const loads: Load[] = loadRows.map((r) => ({ provider: r.provider, loadedUsd: Number(r.loaded), firstTopupOn: r.first }));
  const days = await spendByDay(database, organizationId, spendFrom(monthStart, loads.map((l) => l.firstTopupOn)));
  const billingRows = await database.execute<{
    provider: string;
    days: BillingDays | null;
    balance_usd: string | null;
    loaded_usd: string | null;
    fetched_at: string | null;
    last_error: string | null;
  }>(sql`
    select provider, days, balance_usd::text as balance_usd, loaded_usd::text as loaded_usd,
      to_char(fetched_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as fetched_at, last_error
    from ai_provider_billing
    where organization_id = ${organizationId}
  `);
  const billing: BillingSnapshot[] = billingRows.map((r) => ({
    provider: r.provider,
    days: r.days ?? {},
    balanceUsd: r.balance_usd === null ? null : Number(r.balance_usd),
    loadedUsd: r.loaded_usd === null ? null : Number(r.loaded_usd),
    fetchedAt: r.fetched_at ? new Date(r.fetched_at) : null,
    lastError: r.last_error,
  }));

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
      now,
      monthStart,
      days,
      loads,
      billing,
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
