// Historial del Gasto de IA (Dashboard › Historial del gasto de IA, 1-oct-2026): gasto por día y
// por mes con las mismas reglas que la tarjeta (lib/dashboard/ai-spend.ts): cada día UTC sale de
// lo que cobró el proveedor (ai_provider_billing) y nunca menos de lo que registró el CRM en
// producción; "pruebas" = lo demás (en Anthropic, el espacio «Pruebas»). Los desgloses por modelo
// y por tarea salen del registro de producción (ai_usage): los proveedores no dan ese detalle.
// Días UTC, igual que la consola de cada proveedor.
import { sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { addDays, monthStartUtc, round8, utcDay } from "@/lib/ai/billing/days";
import { getModel } from "@/lib/ai/catalog";
import { TRANSCRIPTION_MODEL_ID } from "@/lib/ai/transcription/rules";
import {
  type BillingSnapshot,
  type DaySpend,
  type Load,
  type TopupRow,
  listTopups,
  loadBillingSnapshots,
  loadTopupTotals,
  providerLabel,
  spendByDay,
  splitDay,
} from "./ai-spend";
import type { DateRange } from "./range";

type Database = Pick<typeof appDb, "execute">;

export type DayTotals = { prod: number; tests: number };
// Gasto de cada día UTC por proveedor.
export type SpendByDay = Map<string, Map<string, DayTotals>>;
export type HistoryDay = { dia: string; total: number; prod: number; tests: number };
export type BreakdownRow = { label: string; total: number };

export type MonthRow = {
  month: string; // YYYY-MM
  label: string; // "octubre de 2026"
  total: number;
  prod: number;
  tests: number;
  topupsUsd: number;
  // Suma de lo que quedaba en cada proveedor con recargas al cerrar el mes (o hoy). null = sin recargas aún.
  balanceUsd: number | null;
  inProgress: boolean;
};

export type AiSpendHistory = {
  range: DateRange & { mes: string | null };
  series: HistoryDay[];
  total: number;
  prod: number;
  tests: number;
  // null = el periodo anterior es de antes de que hubiera datos.
  // `actual` = lo del periodo hasta hoy (si va en curso), contra el mismo tramo del anterior.
  comparison: { actual: number; anterior: number; label: string } | null;
  topupsUsd: number;
  topups: TopupRow[];
  avgPerDay: number;
  daysCounted: number;
  // Solo en el mes en curso.
  projection: { monthLabel: string; ratePerDay: number; projectedUsd: number } | null;
  byProvider: BreakdownRow[];
  byModel: BreakdownRow[];
  byTask: BreakdownRow[];
  months: MonthRow[];
  firstDataDay: string | null;
};

// Qué hizo cada llamada (ai_usage.stage), en palabras del dueño.
export const TASK_LABELS: Record<string, string> = {
  cerebro: "Respuestas del Agente IA",
  detalle: "Lectura en segundo plano (Detalle)",
  filtro: "Limpieza de anuncios",
  transcripcion: "Notas de voz",
};

export function modelLabel(modelId: string): string {
  if (modelId === TRANSCRIPTION_MODEL_ID) return "Notas de voz (gpt-4o-mini-transcribe)";
  return getModel(modelId)?.label ?? modelId;
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function daysBetween(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

// PURO: gasto por día UTC y proveedor a partir del registro del CRM y de las lecturas de los proveedores.
export function buildSpendByDay(days: readonly DaySpend[], billing: readonly BillingSnapshot[]): SpendByDay {
  const crm = new Map<string, number>(); // "proveedor|día"
  const providers = new Set<string>();
  const allDays = new Set<string>();
  for (const d of days) {
    crm.set(`${d.provider}|${d.day}`, (crm.get(`${d.provider}|${d.day}`) ?? 0) + d.usd);
    providers.add(d.provider);
    allDays.add(d.day);
  }
  const snaps = new Map(billing.filter((b) => b.fetchedAt).map((b) => [b.provider, b]));
  for (const b of snaps.values()) {
    providers.add(b.provider);
    for (const day of Object.keys(b.days)) allDays.add(day);
  }
  const out: SpendByDay = new Map();
  for (const day of allDays) {
    const byProvider = new Map<string, DayTotals>();
    for (const provider of providers) {
      const v = splitDay(provider, day, crm.get(`${provider}|${day}`) ?? 0, snaps.get(provider)?.days[day]);
      if (v.prod !== 0 || v.tests !== 0) byProvider.set(provider, v);
    }
    if (byProvider.size) out.set(day, byProvider);
  }
  return out;
}

// Suma de un tramo de días (inclusive), opcionalmente de un solo proveedor.
export function sumDays(spend: SpendByDay, desde: string, hasta: string, provider?: string): DayTotals & { total: number } {
  let prod = 0;
  let tests = 0;
  for (const [day, byProvider] of spend) {
    if (day < desde || day > hasta) continue;
    for (const [p, v] of byProvider) {
      if (provider && p !== provider) continue;
      prod += v.prod;
      tests += v.tests;
    }
  }
  return { prod: round8(prod), tests: round8(tests), total: round8(prod + tests) };
}

// El periodo anterior para comparar y su etiqueta. Mes → el mes anterior; rango libre → el mismo
// número de días justo antes. Si el periodo va en curso, solo se compara el mismo tramo transcurrido.
export function previousPeriod(
  range: DateRange & { mes: string | null },
  today: string,
): { actualHasta: string; desde: string; hasta: string; label: string } {
  const inProgress = range.desde <= today && today <= range.hasta;
  const actualHasta = inProgress ? today : range.hasta;
  const elapsed = daysBetween(range.desde, actualHasta); // días transcurridos − 1
  if (range.mes) {
    const prev = prevMonth(range.mes);
    const prevLast = `${prev}-${String(daysInMonth(prev)).padStart(2, "0")}`;
    const desde = `${prev}-01`;
    const hasta = inProgress ? [addDays(desde, elapsed), prevLast].sort()[0] : prevLast;
    return { actualHasta, desde, hasta, label: inProgress ? "el mes pasado al mismo día" : "el mes anterior" };
  }
  const length = daysBetween(range.desde, range.hasta) + 1;
  const desde = addDays(range.desde, -length);
  return {
    actualHasta,
    desde,
    hasta: addDays(desde, elapsed),
    label: inProgress ? "el periodo anterior al mismo día" : "el periodo anterior",
  };
}

// Proyección del mes en curso: lo gastado + el promedio diario de los últimos 7 días completos ×
// lo que falta del mes (en días con fracción). null sin días completos con datos.
export function projectMonth(spend: SpendByDay, now: Date, firstDataDay: string | null): AiSpendHistory["projection"] {
  if (!firstDataDay) return null;
  const today = utcDay(now);
  const yesterday = addDays(today, -1);
  const weekAgo = addDays(today, -7);
  const from = firstDataDay > weekAgo ? firstDataDay : weekAgo;
  if (from > yesterday) return null;
  const completeDays = daysBetween(from, yesterday) + 1;
  const rate = sumDays(spend, from, yesterday).total / completeDays;
  const month = today.slice(0, 7);
  const monthStart = monthStartUtc(now);
  const elapsed = (now.getTime() - Date.parse(`${monthStart}T00:00:00Z`)) / 86_400_000;
  const remaining = Math.max(0, daysInMonth(month) - elapsed);
  const soFar = sumDays(spend, monthStart, today).total;
  return { monthLabel: monthLabel(month), ratePerDay: round8(rate), projectedUsd: round8(soFar + rate * remaining) };
}

// Una fila por mes, del primero con datos al actual (el más reciente primero).
export function monthlyRows(input: {
  spend: SpendByDay;
  loads: readonly Load[];
  topups: readonly TopupRow[];
  firstDataDay: string | null;
  today: string;
}): MonthRow[] {
  if (!input.firstDataDay) return [];
  const rows: MonthRow[] = [];
  const current = input.today.slice(0, 7);
  for (let month = input.firstDataDay.slice(0, 7); month <= current; month = nextMonth(month)) {
    const desde = `${month}-01`;
    const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
    const end = month === current ? input.today : last;
    const sums = sumDays(input.spend, desde, end);
    const topupsUsd = input.topups.filter((t) => t.toppedUpOn >= desde && t.toppedUpOn <= end).reduce((s, t) => s + t.amountUsd, 0);
    // Saldo al cierre: por proveedor con recargas hasta ese día, lo cargado − lo gastado desde su primera recarga.
    let balance: number | null = null;
    for (const load of input.loads) {
      if (load.firstTopupOn > end) continue;
      const loaded = input.topups.filter((t) => t.provider === load.provider && t.toppedUpOn <= end).reduce((s, t) => s + t.amountUsd, 0);
      const spent = sumDays(input.spend, load.firstTopupOn, end, load.provider).total;
      balance = (balance ?? 0) + loaded - spent;
    }
    rows.push({
      month,
      label: monthLabel(month),
      total: sums.total,
      prod: sums.prod,
      tests: sums.tests,
      topupsUsd: round8(topupsUsd),
      balanceUsd: balance === null ? null : Math.round(balance * 100) / 100,
      inProgress: month === current,
    });
  }
  return rows.reverse();
}

// Primer día con algún dato (gasto del CRM, lectura de proveedor o recarga).
export function firstDay(spend: SpendByDay, loads: readonly Load[]): string | null {
  const candidates = [...spend.keys(), ...loads.map((l) => l.firstTopupOn)].sort();
  return candidates[0] ?? null;
}

// Desglose del registro de producción (ai_usage) por modelo y por tarea en el tramo (días UTC).
async function usageBreakdown(database: Database, organizationId: string, desde: string, hasta: string) {
  const rows = await database.execute<{ model_id: string; stage: string; usd: string | null }>(sql`
    select model_id, stage::text as stage, sum(cost_usd)::text as usd
    from ai_usage
    where organization_id = ${organizationId}
      and created_at >= ${desde}::date and created_at < (${hasta}::date + 1)
    group by 1, 2
  `);
  const byModel = new Map<string, number>();
  const byTask = new Map<string, number>();
  for (const r of rows) {
    const usd = Number(r.usd ?? 0);
    if (!usd) continue;
    const m = modelLabel(r.model_id);
    byModel.set(m, (byModel.get(m) ?? 0) + usd);
    const t = TASK_LABELS[r.stage] ?? r.stage;
    byTask.set(t, (byTask.get(t) ?? 0) + usd);
  }
  const sorted = (m: Map<string, number>) => [...m].map(([label, total]) => ({ label, total: round8(total) })).sort((a, b) => b.total - a.total);
  return { byModel: sorted(byModel), byTask: sorted(byTask) };
}

export async function aiSpendHistory(
  database: Database,
  organizationId: string,
  range: DateRange & { mes: string | null },
  options: { now?: Date } = {},
): Promise<AiSpendHistory> {
  const now = options.now ?? new Date();
  const today = utcDay(now);
  const [loads, billing, allTopups] = await Promise.all([
    loadTopupTotals(database, organizationId),
    loadBillingSnapshots(database, organizationId),
    listTopups(database, organizationId),
  ]);
  const prev = previousPeriod(range, today);
  // Desde lo más antiguo que haga falta: el periodo anterior, la primera recarga o el primer mes con datos.
  const from = [prev.desde, ...loads.map((l) => l.firstTopupOn), ...billing.flatMap((b) => Object.keys(b.days))].sort()[0];
  const crmDays = await spendByDay(database, organizationId, from);
  const spend = buildSpendByDay(crmDays, billing);
  const firstDataDay = firstDay(spend, loads);

  const series: HistoryDay[] = [];
  for (let d = range.desde; d <= range.hasta; d = addDays(d, 1)) {
    const s = sumDays(spend, d, d);
    series.push({ dia: d, total: s.total, prod: s.prod, tests: s.tests });
  }
  const period = sumDays(spend, range.desde, range.hasta);
  const actual = sumDays(spend, range.desde, prev.actualHasta);
  const comparable = firstDataDay !== null && prev.desde >= firstDataDay;
  const counted = range.desde > today ? 0 : daysBetween(range.desde, prev.actualHasta) + 1;
  const providers = new Set<string>();
  for (const byProvider of spend.values()) for (const p of byProvider.keys()) providers.add(p);
  const byProvider = [...providers]
    .map((p) => ({ label: providerLabel(p), total: sumDays(spend, range.desde, range.hasta, p).total }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  const usage = await usageBreakdown(database, organizationId, range.desde, range.hasta);
  const topups = allTopups.filter((t) => t.toppedUpOn >= range.desde && t.toppedUpOn <= range.hasta);

  return {
    range,
    series,
    total: period.total,
    prod: period.prod,
    tests: period.tests,
    comparison: comparable ? { actual: actual.total, anterior: sumDays(spend, prev.desde, prev.hasta).total, label: prev.label } : null,
    topupsUsd: round8(topups.reduce((s, t) => s + t.amountUsd, 0)),
    topups,
    avgPerDay: counted > 0 ? round8(actual.total / counted) : 0,
    daysCounted: counted,
    projection: range.mes === today.slice(0, 7) ? projectMonth(spend, now, firstDataDay) : null,
    byProvider,
    byModel: usage.byModel,
    byTask: usage.byTask,
    months: monthlyRows({ spend, loads, topups: allTopups, firstDataDay, today }),
    firstDataDay,
  };
}
