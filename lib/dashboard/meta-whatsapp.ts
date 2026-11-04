// «Gasto de WhatsApp (Meta)» del Dashboard (4-nov-2026, pedido del dueño; docs/meta-whatsapp.md): la tarjeta
// (lo que va del mes y el mes anterior) y su sección (Dashboard › Gasto de WhatsApp). Dos fuentes:
// - lo que Meta reporta del número (meta_whatsapp_pricing, lo lee el worker cada hora de Zernio): el monto,
//   por tipo de mensaje y lo que salió gratis. Es la cifra de la factura.
// - la marca de Meta en cada mensaje (messages.meta_*): de dónde salió cada mensaje cobrado (Ángela,
//   automatizaciones, seguimientos, vendedores). Su costo es aproximado: mensajes × lo que cobró Meta en
//   promedio por mensaje de ese tipo en el periodo.
// Días UTC, como la factura de Meta. `summarize*` son PURAS; los `load*` solo consultan.
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { metaWhatsappPricing, metaWhatsappPricingSync } from "@/lib/db/schema";
import { addDays, utcDay } from "@/lib/ai/billing/days";
import type { DateRange } from "./range";
import { shortDate } from "./railway";
import type { DailyCount } from "./queries";

type Database = Pick<typeof appDb, "select" | "execute">;

// Se lee cada hora y Meta reporta con unas horas de atraso: más de 3 h sin lectura buena ya es raro.
export const META_STALE_MINUTES = 180;

// Lo que cobró Meta por mensaje en oct-2026 (factura del 1-nov, sin IVA). Solo si en el periodo no hay
// mensajes cobrados de ese tipo para sacar el promedio real.
export const META_FALLBACK_RATE_USD: Record<string, number> = { marketing: 0.0407, utility: 0.0084, service: 0.0115 };

const CATEGORY_LABELS: Record<string, string> = {
  marketing: "Plantillas de marketing",
  marketing_lite: "Plantillas de marketing",
  utility: "Plantillas de utilidad",
  service: "Mensajes normales",
  authentication: "Plantillas de autenticación",
  authentication_international: "Plantillas de autenticación",
};

const FREE_LABELS: Record<string, string> = {
  free_entry_point: "Por anuncio",
  free_customer_service: "De servicio",
};

export type MetaOrigin = "agente" | "workflow" | "seguimiento" | "vendedor" | "celular" | "otro";

const ORIGIN_LABELS: Record<MetaOrigin, string> = {
  agente: "Ángela (Agente IA)",
  workflow: "Automatizaciones",
  seguimiento: "Seguimientos",
  vendedor: "Vendedores desde el CRM",
  celular: "Celular o WhatsApp Web",
  otro: "Otros",
};

export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c;
const freeLabel = (t: string) => FREE_LABELS[t] ?? "Otros";
const round2 = (n: number) => Math.round(n * 100) / 100;
const monthName = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", month: "long" });

export type MetaPricingRow = { day: string; category: string; pricingType: string; volume: number; costUsd: number | null };
type SyncRow = { fetchedAt: Date | null; lastError: string | null };

function updatedMinutesAgo(sync: SyncRow | null, now: Date): number | null {
  return sync?.fetchedAt ? Math.max(0, Math.floor((now.getTime() - sync.fetchedAt.getTime()) / 60_000)) : null;
}

// "Actualizado hace 3 min" / "Sin actualizar desde hace 4 h" / "No se pudo leer de Meta".
export function metaFreshness(s: { updatedMinutesAgo: number | null; lastError: string | null }): { text: string; tone: "muted" | "orange" } {
  const m = s.updatedMinutesAgo;
  if (m === null) return { text: s.lastError ? "No se pudo leer el cobro de Meta" : "Aún sin leer", tone: "orange" };
  const ago = m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
  if (m >= META_STALE_MINUTES || s.lastError) return { text: `Sin actualizar desde hace ${ago}`, tone: "orange" };
  return { text: `Actualizado hace ${ago}`, tone: "muted" };
}

// ---- Tarjeta del Dashboard ----

export type MetaWhatsappSummary = {
  monthLabel: string;
  totalUsd: number | null;
  charged: number;
  prevMonthLabel: string;
  prevTotalUsd: number | null;
  updatedMinutesAgo: number | null;
  lastError: string | null;
};

function sumCost(rows: MetaPricingRow[]): number | null {
  const withCost = rows.filter((r) => r.costUsd !== null);
  return withCost.length ? round2(withCost.reduce((s, r) => s + (r.costUsd ?? 0), 0)) : rows.length ? null : 0;
}

export function summarizeMetaMonth(rows: MetaPricingRow[], sync: SyncRow | null, now: Date): MetaWhatsappSummary {
  const month = utcDay(now).slice(0, 7);
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prev = utcDay(prevStart).slice(0, 7);
  const thisMonth = rows.filter((r) => r.day.startsWith(month));
  const prevMonth = rows.filter((r) => r.day.startsWith(prev));
  return {
    monthLabel: monthName.format(now),
    totalUsd: sumCost(thisMonth),
    charged: thisMonth.filter((r) => r.pricingType === "regular").reduce((s, r) => s + r.volume, 0),
    prevMonthLabel: monthName.format(prevStart),
    prevTotalUsd: prevMonth.length ? sumCost(prevMonth) : null,
    updatedMinutesAgo: updatedMinutesAgo(sync, now),
    lastError: sync?.lastError ?? null,
  };
}

async function loadRows(database: Database, organizationId: string, desde: string, hasta: string): Promise<MetaPricingRow[]> {
  return database
    .select({
      day: metaWhatsappPricing.day,
      category: metaWhatsappPricing.category,
      pricingType: metaWhatsappPricing.pricingType,
      volume: metaWhatsappPricing.volume,
      costUsd: metaWhatsappPricing.costUsd,
    })
    .from(metaWhatsappPricing)
    .where(and(eq(metaWhatsappPricing.organizationId, organizationId), gte(metaWhatsappPricing.day, desde), lte(metaWhatsappPricing.day, hasta)));
}

async function loadSync(database: Database, organizationId: string): Promise<SyncRow | null> {
  const [row] = await database
    .select({ fetchedAt: metaWhatsappPricingSync.fetchedAt, lastError: metaWhatsappPricingSync.lastError })
    .from(metaWhatsappPricingSync)
    .where(eq(metaWhatsappPricingSync.organizationId, organizationId));
  return row ?? null;
}

// null = el worker aún no lee el cobro de Meta (sin llave de Zernio o sin número): no hay tarjeta.
export async function metaWhatsappSummary(
  database: Database,
  organizationId: string,
  options: { now?: Date } = {},
): Promise<MetaWhatsappSummary | null> {
  const now = options.now ?? new Date();
  const sync = await loadSync(database, organizationId);
  if (!sync) return null;
  const prevStart = utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const rows = await loadRows(database, organizationId, prevStart, utcDay(now));
  return summarizeMetaMonth(rows, sync, now);
}

// ---- Sección «Gasto de WhatsApp» ----

export type MarkCount = { origin: MetaOrigin; category: string; messages: number };
export type MarkItem = { kind: "workflow" | "plantilla"; name: string; category: string; messages: number };
export type BreakdownRow = { label: string; total: number };

export type MetaWhatsappHistory = {
  totalUsd: number | null;
  charged: number;
  free: number;
  freeRows: BreakdownRow[];
  byCategory: BreakdownRow[];
  series: DailyCount[];
  byOrigin: BreakdownRow[];
  topItems: BreakdownRow[];
  markedCharged: number;
  marksSince: string | null;
  fromPhone: number;
  updatedMinutesAgo: number | null;
  lastError: string | null;
};

// Lo que cobró Meta en promedio por mensaje de cada tipo en el periodo (o el de octubre si no hubo).
export function ratesFrom(rows: MetaPricingRow[]): Record<string, number> {
  const acc = new Map<string, { volume: number; cost: number }>();
  for (const r of rows) {
    if (r.pricingType !== "regular" || r.costUsd === null || r.volume <= 0) continue;
    const cur = acc.get(r.category) ?? { volume: 0, cost: 0 };
    cur.volume += r.volume;
    cur.cost += r.costUsd;
    acc.set(r.category, cur);
  }
  const rates: Record<string, number> = { ...META_FALLBACK_RATE_USD };
  for (const [category, v] of acc) rates[category] = v.cost / v.volume;
  return rates;
}

function grouped(entries: { label: string; total: number }[]): BreakdownRow[] {
  const byLabel = new Map<string, number>();
  for (const e of entries) byLabel.set(e.label, (byLabel.get(e.label) ?? 0) + e.total);
  return [...byLabel]
    .map(([label, total]) => ({ label, total: round2(total) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"));
}

export function summarizeMetaHistory(input: {
  range: DateRange;
  rows: MetaPricingRow[];
  marks: MarkCount[];
  items: MarkItem[];
  marksSince: Date | null;
  fromPhone: number;
  sync: SyncRow | null;
  now: Date;
}): MetaWhatsappHistory {
  const { rows } = input;
  const rates = ratesFrom(rows);
  const cost = (category: string, messages: number) => messages * (rates[category] ?? 0);
  const charged = rows.filter((r) => r.pricingType === "regular");
  const freeOnes = rows.filter((r) => r.pricingType !== "regular");

  const today = utcDay(input.now);
  const last = input.range.hasta < today ? input.range.hasta : today;
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + (r.costUsd ?? 0));
  const series: DailyCount[] = [];
  for (let d = input.range.desde; d <= last; d = addDays(d, 1)) series.push({ dia: d, total: round2(perDay.get(d) ?? 0) });

  return {
    totalUsd: sumCost(rows),
    charged: charged.reduce((s, r) => s + r.volume, 0),
    free: freeOnes.reduce((s, r) => s + r.volume, 0),
    freeRows: grouped(freeOnes.map((r) => ({ label: freeLabel(r.pricingType), total: r.volume }))),
    byCategory: grouped(charged.map((r) => ({ label: categoryLabel(r.category), total: r.costUsd ?? 0 }))),
    series,
    byOrigin: grouped(input.marks.map((m) => ({ label: ORIGIN_LABELS[m.origin], total: cost(m.category, m.messages) }))),
    topItems: grouped(
      input.items.map((i) => ({ label: i.kind === "workflow" ? `«${i.name}» (automatización)` : `${i.name} (plantilla)`, total: cost(i.category, i.messages) })),
    ).slice(0, 8),
    markedCharged: input.marks.reduce((s, m) => s + m.messages, 0),
    marksSince: input.marksSince ? shortDate(input.marksSince) : null,
    fromPhone: input.fromPhone,
    updatedMinutesAgo: updatedMinutesAgo(input.sync, input.now),
    lastError: input.sync?.lastError ?? null,
  };
}

const ORIGIN_SQL = sql`case
  when m.metadata ? 'seguimiento' then 'seguimiento'
  when r.workflow_id is not null then 'workflow'
  when m.source = 'ai_agent' then 'agente'
  when m.source = 'crm' then 'vendedor'
  when m.source = 'business_app' then 'celular'
  else 'otro' end`;

export async function metaWhatsappHistory(
  database: Database,
  organizationId: string,
  range: DateRange,
  options: { now?: Date } = {},
): Promise<MetaWhatsappHistory> {
  const now = options.now ?? new Date();
  // created_at es UTC sin zona: los límites van igual, como timestamp sin zona.
  const ini = range.desde;
  const fin = addDays(range.hasta, 1);
  // Salientes cobrados del periodo con su marca, y la corrida del workflow que los mandó (si fue uno). Se arma
  // de nuevo en cada consulta: un `sql` de drizzle no se comparte entre dos.
  const charged = () => sql`
    from messages m
    left join lateral (
      select wr.workflow_id from workflow_runs wr
      where wr.organization_id = m.organization_id and wr.conversation_id = m.conversation_id and wr.message_ids ? m.id
      limit 1
    ) r on true
    left join workflows w on w.id = r.workflow_id and w.organization_id = m.organization_id
    where m.organization_id = ${organizationId} and m.direction = 'out' and m.meta_billable
      and m.meta_category is not null and m.created_at >= ${ini}::timestamp and m.created_at < ${fin}::timestamp`;

  const [rows, sync, marks, items, [since], [phone]] = await Promise.all([
    loadRows(database, organizationId, range.desde, range.hasta),
    loadSync(database, organizationId),
    database.execute<{ origin: MetaOrigin; category: string; messages: number }>(sql`
      select ${ORIGIN_SQL} as origin, m.meta_category as category, count(*)::int as messages ${charged()} group by 1, 2`),
    database.execute<{ kind: "workflow" | "plantilla"; name: string; category: string; messages: number }>(sql`
      select case when r.workflow_id is not null then 'workflow' else 'plantilla' end as kind,
        coalesce(w.name, m.template_name) as name, m.meta_category as category, count(*)::int as messages
      ${charged()} and (r.workflow_id is not null or m.template_name is not null)
      group by 1, 2, 3`),
    // En segundos UTC: un timestamp sin zona leído crudo se tomaría en la hora local.
    database.execute<{ since: number | null }>(sql`
      select extract(epoch from min(created_at))::float8 as since from messages
      where organization_id = ${organizationId} and direction = 'out' and meta_category is not null`),
    database.execute<{ n: number }>(sql`
      select count(*)::int as n from messages
      where organization_id = ${organizationId} and direction = 'out' and source = 'business_app' and imported_at is null
        and created_at >= ${ini}::timestamp and created_at < ${fin}::timestamp`),
  ]);
  return summarizeMetaHistory({
    range,
    rows,
    marks: [...marks],
    items: [...items],
    marksSince: since?.since ? new Date(Number(since.since) * 1000) : null,
    fromPhone: phone?.n ?? 0,
    sync,
    now,
  });
}
