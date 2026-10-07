// Resumen de la tarjeta «Railway» del Dashboard (7-oct-2026): uso del periodo de cobro, lo que
// queda de lo incluido en el plan y la factura estimada al corte. Sale de railway_billing (lo lee
// el worker cada 5 min: lib/railway-billing/sync.ts). `summarizeRailway` es PURA;
// `railwaySummary` solo carga la fila.
import { eq } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { railwayBilling } from "@/lib/db/schema";
import { SPEND_ALERT_PCT, STALE_MINUTES } from "./ai-spend-bar";

type Database = Pick<typeof appDb, "select">;

// Lo que trae incluido cada plan (docs de Railway, oct-2026): Hobby cuesta US$5 al mes e incluye
// US$5 de uso; Pro, US$20 e incluye US$20. Lo que pase se cobra al corte. Otro plan: sin barra.
const INCLUDED_USD: Record<string, number> = { HOBBY: 5, PRO: 20 };
const PLAN_LABELS: Record<string, string> = { HOBBY: "Hobby", PRO: "Pro", FREE: "Free" };

// Antes de un día de periodo la proyección brinca demasiado: no se muestra.
const MIN_HOURS_FOR_ESTIMATE = 24;

const VENDOR_ZONE = "America/Mazatlan";
const dayMonth = new Intl.DateTimeFormat("es-MX", { timeZone: VENDOR_ZONE, day: "numeric", month: "short" });

// "5-oct" (como escribe el dueño las fechas), en hora de Mazatlán.
export function shortDate(d: Date): string {
  const parts = dayMonth.formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = (parts.find((p) => p.type === "month")?.value ?? "").replace(".", "");
  return `${day}-${month}`;
}

export type RailwaySummary = {
  planLabel: string | null;
  periodStartLabel: string | null;
  periodEndLabel: string | null;
  usageUsd: number | null;
  // Lo incluido en el plan y cuánto queda (null si el plan no trae uso incluido).
  includedUsd: number | null;
  includedLeftUsd: number | null;
  includedPct: number | null;
  includedTone: "navy" | "orange";
  // Lo que ya pasó de lo incluido (se cobra a la tarjeta al corte).
  overUsd: number;
  // max(incluido, uso proyectado al cierre); null en el primer día o sin periodo.
  estimatedBillUsd: number | null;
  // Aviso naranja si Railway no tiene el cobro al corriente (pago vencido o plan cancelado): con la
  // tarjeta rechazada hay pocos días de gracia antes de que detenga los servidores. null = al corriente.
  billingAlert: string | null;
  updatedMinutesAgo: number | null;
  lastError: string | null;
};

type Row = {
  plan: string | null;
  state: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  usageUsd: number | null;
  fetchedAt: Date | null;
  lastError: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Estado del cobro según Railway (ACTIVE | PAST_DUE | UNPAID | CANCELLED | INACTIVE) → aviso.
export function billingAlertFor(state: string | null): string | null {
  if (!state || state === "ACTIVE") return null;
  if (state === "PAST_DUE" || state === "UNPAID") {
    return "Railway marca un pago pendiente: revisa la tarjeta en Railway › Workspace › Billing antes de que detenga los servidores.";
  }
  return "Railway marca el plan como cancelado o inactivo: revisa Railway › Workspace › Billing.";
}

export function summarizeRailway(row: Row, now: Date): RailwaySummary {
  const included = row.plan ? (INCLUDED_USD[row.plan] ?? null) : null;
  const usage = row.usageUsd;
  let includedLeftUsd: number | null = null;
  let includedPct: number | null = null;
  let overUsd = 0;
  if (included !== null && usage !== null) {
    includedLeftUsd = round2(Math.max(0, included - usage));
    includedPct = Math.min(100, (usage / included) * 100);
    overUsd = round2(Math.max(0, usage - included));
  }

  let estimatedBillUsd: number | null = null;
  if (row.periodStart && row.periodEnd && usage !== null) {
    const total = row.periodEnd.getTime() - row.periodStart.getTime();
    const elapsed = Math.min(total, now.getTime() - row.periodStart.getTime());
    if (total > 0 && elapsed >= MIN_HOURS_FOR_ESTIMATE * 3_600_000) {
      const projected = (usage * total) / elapsed;
      estimatedBillUsd = round2(Math.max(included ?? 0, projected));
    }
  }

  return {
    planLabel: row.plan ? (PLAN_LABELS[row.plan] ?? row.plan) : null,
    periodStartLabel: row.periodStart ? shortDate(row.periodStart) : null,
    periodEndLabel: row.periodEnd ? shortDate(row.periodEnd) : null,
    usageUsd: usage === null ? null : round2(usage),
    includedUsd: included,
    includedLeftUsd,
    includedPct,
    includedTone: includedPct !== null && includedPct >= SPEND_ALERT_PCT ? "orange" : "navy",
    overUsd,
    estimatedBillUsd,
    billingAlert: billingAlertFor(row.state),
    updatedMinutesAgo: row.fetchedAt ? Math.max(0, Math.floor((now.getTime() - row.fetchedAt.getTime()) / 60_000)) : null,
    lastError: row.lastError,
  };
}

// null = no hay lectura (sin token en el worker): la tarjeta no aparece.
export async function railwaySummary(
  database: Database,
  organizationId: string,
  options: { now?: Date } = {},
): Promise<RailwaySummary | null> {
  const [row] = await database.select().from(railwayBilling).where(eq(railwayBilling.organizationId, organizationId));
  if (!row) return null;
  return summarizeRailway(row, options.now ?? new Date());
}

// "Actualizado hace 3 min" / "Sin actualizar desde hace 2 h" / "No se pudo leer de Railway".
export function railwayFreshness(s: Pick<RailwaySummary, "updatedMinutesAgo" | "lastError">): { text: string; tone: "muted" | "orange" } {
  const m = s.updatedMinutesAgo;
  if (m === null) return { text: s.lastError ? "No se pudo leer de Railway" : "Aún sin leer", tone: "orange" };
  const ago = m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
  if (m >= STALE_MINUTES || s.lastError) return { text: `Sin actualizar desde hace ${ago}`, tone: "orange" };
  return { text: `Actualizado hace ${ago}`, tone: "muted" };
}
