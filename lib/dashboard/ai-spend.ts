// Gasto de IA del Dashboard (solo owner/admin). Producción y staging usan las MISMAS
// llaves de OpenAI/Anthropic (24-sep-2026), así que la tarjeta muestra, por
// proveedor, el gasto del MES (días locales de Mazatlán) de producción y el de
// pruebas (staging), y un SALDO ESTIMADO = recargas − gasto de ambos desde la
// primera recarga. Ni OpenAI ni Anthropic dan el saldo por API
// (docs/investigacion/gasto-ia-saldo.md): el gasto sale de ai_usage.cost_usd
// (precios internos de lib/ai/pricing.ts). El gasto de staging llega por HTTP
// (lib/dashboard/staging-spend.ts); si no responde, el saldo solo descuenta producción.
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

// Gasto del otro entorno (staging) visto desde producción.
// ok = llegó · no_config = faltan STAGING_APP_URL / AI_SPEND_TOKEN · unreachable = no respondió.
export type RemoteSpend = { status: "ok"; days: DaySpend[] } | { status: "no_config" | "unreachable" };

// "production": la tarjeta separa producción y staging. "staging": este ES el entorno
// de pruebas; solo muestra su propio gasto.
export type SpendEnvironment = "production" | "staging";

export type ProviderSpend = {
  provider: string;
  label: string;
  // Gasto de ESTE entorno en el mes.
  monthUsd: number;
  // Gasto de staging en el mes; null = sin dato (no respondió, sin configurar o este es staging).
  stagingMonthUsd: number | null;
  // null = sin recargas registradas (no hay saldo que estimar).
  loadedUsd: number | null;
  firstTopupOn: string | null;
  spentSinceFirstUsd: number | null;
  stagingSpentSinceFirstUsd: number | null;
  balanceUsd: number | null;
};

export type TopupRow = { id: string; provider: string; label: string; amountUsd: number; toppedUpOn: string; author: string | null };

export type AiSpendSummary = {
  monthLabel: string;
  environment: SpendEnvironment;
  // Cómo llegó el gasto de staging (en staging mismo siempre "self").
  staging: RemoteSpend["status"] | "self";
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

// PURO: arma los números de cada proveedor a partir del gasto diario de este entorno,
// el de staging (null = sin dato) y las recargas.
export function summarizeProviders(input: {
  monthStart: string;
  ownDays: readonly DaySpend[];
  stagingDays: readonly DaySpend[] | null;
  loads: readonly Load[];
}): ProviderSpend[] {
  const monthEnd = nextMonthStart(input.monthStart);
  const loadBy = new Map(input.loads.map((l) => [l.provider, l]));
  const seen = new Set<string>([...ALWAYS]);
  for (const d of input.ownDays) seen.add(d.provider);
  for (const d of input.stagingDays ?? []) seen.add(d.provider);
  for (const l of input.loads) seen.add(l.provider);
  return [...seen].map((provider) => {
    const load = loadBy.get(provider);
    const staging = input.stagingDays;
    const spentOwn = load ? sumDays(input.ownDays, provider, load.firstTopupOn) : null;
    const spentStaging = load && staging ? sumDays(staging, provider, load.firstTopupOn) : null;
    return {
      provider,
      label: providerLabel(provider),
      monthUsd: sumDays(input.ownDays, provider, input.monthStart, monthEnd),
      stagingMonthUsd: staging ? sumDays(staging, provider, input.monthStart, monthEnd) : null,
      loadedUsd: load ? load.loadedUsd : null,
      firstTopupOn: load?.firstTopupOn ?? null,
      spentSinceFirstUsd: spentOwn,
      stagingSpentSinceFirstUsd: spentStaging,
      balanceUsd: load ? estimateBalance(load.loadedUsd, (spentOwn ?? 0) + (spentStaging ?? 0)) : null,
    };
  });
}

// Gasto por día LOCAL (Mazatlán) y proveedor desde `from` (inclusive). Con
// organizationId = null suma TODAS las organizaciones del entorno: es lo que consume
// la llave (la usa el endpoint que staging le expone a producción).
export async function spendByDay(database: Database, organizationId: string | null, from: string): Promise<DaySpend[]> {
  const byOrg = organizationId === null ? sql`` : sql`and organization_id = ${organizationId}`;
  const rows = await database.execute<{ day: string; provider: string; usd: string | null }>(sql`
    select to_char((created_at at time zone 'UTC') at time zone ${tz}, 'YYYY-MM-DD') as day,
      provider, sum(cost_usd)::text as usd
    from ai_usage
    where created_at >= (((${from}::date)::timestamp at time zone ${tz}) at time zone 'UTC')
      ${byOrg}
    group by 1, 2
    order by 1, 2
  `);
  return rows.map((r) => ({ day: r.day, provider: r.provider, usd: Number(r.usd ?? 0) }));
}

export async function aiSpendSummary(
  database: Database,
  organizationId: string,
  options: {
    now?: Date;
    environment?: SpendEnvironment;
    // Lee el gasto de staging desde `from` (solo en producción).
    fetchStaging?: (from: string) => Promise<RemoteSpend>;
  } = {},
): Promise<AiSpendSummary> {
  const environment = options.environment ?? "production";
  const today = localToday(options.now ?? new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const loadRows = await database.execute<{ provider: string; loaded: string; first: string }>(sql`
    select provider, sum(amount_usd)::text as loaded, to_char(min(topped_up_on), 'YYYY-MM-DD') as first
    from ai_credit_topups
    where organization_id = ${organizationId}
    group by provider
  `);
  const loads: Load[] = loadRows.map((r) => ({ provider: r.provider, loadedUsd: Number(r.loaded), firstTopupOn: r.first }));
  const from = spendFrom(monthStart, loads.map((l) => l.firstTopupOn));

  const [ownDays, remote] = await Promise.all([
    spendByDay(database, organizationId, from),
    environment === "staging" || !options.fetchStaging
      ? Promise.resolve<RemoteSpend | null>(null)
      : options.fetchStaging(from),
  ]);
  const staging: AiSpendSummary["staging"] = environment === "staging" ? "self" : (remote?.status ?? "no_config");

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
    environment,
    staging,
    providers: summarizeProviders({
      monthStart,
      ownDays,
      stagingDays: remote?.status === "ok" ? remote.days : null,
      loads,
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
