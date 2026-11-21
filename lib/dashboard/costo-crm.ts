// «Costo del CRM» (20-nov-2026, pedido del dueño: el monto mensual y total del mantenimiento del CRM, hasta arriba
// del Dashboard). Suma la lista fija del correo del día 3 (docs/costos.md): IA, WhatsApp (Meta), Railway y Zernio, en
// dólares sin impuestos. Tres cifras:
// - Va: lo que llevan este mes (días UTC, como cobran los proveedores). Railway: lo de su periodo actual, nunca menos
//   de lo que cuesta el plan (se cobra igual).
// - Cierre estimado: si siguen al ritmo de estos días (IA: promedio de los últimos 7 días, como el Historial; Railway y
//   Zernio: su factura estimada; Meta: lo que va llevado al mes completo). El primer día del mes no se calcula.
// - Mes pasado: el que guardó el worker (crm_cost_months, lib/costos/guardar-mes.ts). 21-nov-2026 (dueño): sin total
//   acumulado; cada mes se ve en Dashboard › Historial de costos.
import { and, asc, eq, lt } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { crmCostMonths } from "@/lib/db/schema";
import { addDays, monthStartUtc, utcDay } from "@/lib/ai/billing/days";
import { type AiSpendSummary, loadBillingSnapshots, loadTopupTotals, spendByDay } from "./ai-spend";
import { buildSpendByDay, firstDay, projectMonth } from "./ai-spend-history";
import type { MetaWhatsappSummary } from "./meta-whatsapp";
import type { RailwaySummary } from "./railway";
import type { ZernioSummary } from "./zernio";

type Database = Pick<typeof appDb, "select" | "execute">;

export type ServicioCosto = "ia" | "meta" | "railway" | "zernio";

export const SERVICIO_LABEL: Record<ServicioCosto, string> = {
  meta: "WhatsApp (Meta)",
  ia: "IA",
  railway: "Railway",
  zernio: "Zernio",
};

export type ParteCosto = { servicio: ServicioCosto; label: string; usd: number; pct: number };

export type MesGuardado = { month: string; iaUsd: number | null; metaUsd: number | null; railwayUsd: number | null; zernioUsd: number | null };

export type CostoCrm = {
  // "noviembre"
  monthLabel: string;
  vaUsd: number;
  // De lo que va, de mayor a menor (sin los que van en cero).
  partes: ParteCosto[];
  // Servicios sin lectura este mes: el monto va sin ellos.
  sinDato: string[];
  // null el primer día del mes (todavía no hay ritmo).
  cierreUsd: number | null;
  prevLabel: string;
  // null = el mes anterior aún no está guardado.
  prevUsd: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthName = new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: "UTC" });

function monthDate(month: string): Date {
  return new Date(`${month}-15T12:00:00Z`);
}

function prevMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function sumaMes(fila: MesGuardado): number {
  return (fila.iaUsd ?? 0) + (fila.metaUsd ?? 0) + (fila.railwayUsd ?? 0) + (fila.zernioUsd ?? 0);
}

type Tramo = { va: number | null; cierre: number | null };

// PURO: junta lo que ya calculó cada tarjeta del Dashboard con los meses guardados.
export function resumirCostoCrm(input: {
  now: Date;
  spend: AiSpendSummary | null;
  // Proyección del gasto de IA al cierre del mes (projectMonth); null = sin datos para proyectar.
  iaProyeccionUsd: number | null;
  meta: MetaWhatsappSummary | null;
  railway: RailwaySummary | null;
  zernio: ZernioSummary | null;
  guardados: readonly MesGuardado[];
}): CostoCrm {
  const { now } = input;
  const month = utcDay(now).slice(0, 7);
  const elapsedDays = (now.getTime() - Date.parse(`${monthStartUtc(now)}T00:00:00Z`)) / 86_400_000;
  const primerDia = elapsedDays < 1;

  const ia: Tramo = input.spend
    ? (() => {
        const va = input.spend.providers.reduce((sum, p) => sum + p.monthUsd, 0);
        return { va, cierre: Math.max(va, input.iaProyeccionUsd ?? va) };
      })()
    : { va: null, cierre: null };
  const metaVa = input.meta?.totalUsd ?? null;
  const meta: Tramo = { va: metaVa, cierre: metaVa === null || primerDia ? metaVa : (metaVa / elapsedDays) * daysInMonth(month) };
  const r = input.railway;
  const railwayVa = r && r.usageUsd !== null ? Math.max(r.includedUsd ?? 0, r.usageUsd) : null;
  const railway: Tramo = { va: railwayVa, cierre: r?.estimatedBillUsd ?? railwayVa };
  const zernio: Tramo = { va: input.zernio?.totalUsd ?? null, cierre: input.zernio?.estimatedBillUsd ?? input.zernio?.totalUsd ?? null };

  const tramos: Record<ServicioCosto, Tramo> = { meta, ia, railway, zernio };
  const servicios = Object.keys(tramos) as ServicioCosto[];
  const vaUsd = servicios.reduce((sum, s) => sum + (tramos[s].va ?? 0), 0);
  const cierreUsd = primerDia ? null : servicios.reduce((sum, s) => sum + (tramos[s].cierre ?? tramos[s].va ?? 0), 0);
  const partes = servicios
    .filter((s) => (tramos[s].va ?? 0) > 0)
    .map((s) => ({ servicio: s, label: SERVICIO_LABEL[s], usd: round2(tramos[s].va ?? 0), pct: vaUsd > 0 ? ((tramos[s].va ?? 0) / vaUsd) * 100 : 0 }))
    .sort((a, b) => b.usd - a.usd);

  const prevKey = prevMonthKey(month);
  const prev = input.guardados.find((g) => g.month === prevKey);
  return {
    monthLabel: monthName.format(monthDate(month)),
    vaUsd: round2(vaUsd),
    partes,
    sinDato: servicios.filter((s) => tramos[s].va === null).map((s) => SERVICIO_LABEL[s]),
    cierreUsd: cierreUsd === null ? null : round2(cierreUsd),
    prevLabel: monthName.format(monthDate(prevKey)),
    prevUsd: prev ? round2(sumaMes(prev)) : null,
  };
}

export type CostoCrmBase = { guardados: MesGuardado[]; iaProyeccionUsd: number | null };

// Lo que la tarjeta necesita además de los resúmenes de las otras tarjetas: los meses guardados y la proyección de IA.
export async function cargarCostoCrm(database: Database, organizationId: string, options: { now?: Date } = {}): Promise<CostoCrmBase> {
  const now = options.now ?? new Date();
  const month = utcDay(now).slice(0, 7);
  const from = [monthStartUtc(now), addDays(utcDay(now), -7)].sort()[0];
  const [guardados, loads, billing, days] = await Promise.all([
    database
      .select({
        month: crmCostMonths.month,
        iaUsd: crmCostMonths.iaUsd,
        metaUsd: crmCostMonths.metaUsd,
        railwayUsd: crmCostMonths.railwayUsd,
        zernioUsd: crmCostMonths.zernioUsd,
      })
      .from(crmCostMonths)
      .where(and(eq(crmCostMonths.organizationId, organizationId), lt(crmCostMonths.month, month)))
      .orderBy(asc(crmCostMonths.month)),
    loadTopupTotals(database, organizationId),
    loadBillingSnapshots(database, organizationId),
    spendByDay(database, organizationId, from),
  ]);
  const spend = buildSpendByDay(days, billing, now);
  const projection = projectMonth(spend, now, firstDay(spend, loads));
  return { guardados, iaProyeccionUsd: projection?.projectedUsd ?? null };
}
