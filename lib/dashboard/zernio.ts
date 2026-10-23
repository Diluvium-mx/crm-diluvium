// Resumen de la tarjeta «Zernio» del Dashboard (23-oct-2026): lo que va del mes de Zernio (mensajes
// y cuentas conectadas), lo del mes anterior y un aviso si Zernio marca un problema de pago. Sale de
// zernio_billing (lo lee el worker cada 15 min: lib/zernio-billing/sync.ts). `summarizeZernio` es
// PURA; `zernioSummary` solo carga la fila.
import { eq } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { zernioBilling } from "@/lib/db/schema";

type Database = Pick<typeof appDb, "select">;

// Se lee cada 15 min: más de 45 sin lectura buena ya es raro.
export const ZERNIO_STALE_MINUTES = 45;

// Zernio cobra por mes calendario en días UTC: el nombre del mes sale en UTC.
const monthName = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", month: "long" });

export type ZernioSummary = {
  monthLabel: string | null;
  totalUsd: number | null;
  messagesUsd: number | null;
  accountsUsd: number | null;
  // Otros conceptos de la factura (números, llamadas, SMS…): solo se muestran si cobran algo.
  otherUsd: number;
  prevTotalUsd: number | null;
  prevMonthLabel: string | null;
  // Aviso naranja si Zernio suspendió la cuenta o tiene un pago pendiente. null = al corriente.
  billingAlert: string | null;
  updatedMinutesAgo: number | null;
  lastError: string | null;
};

type Row = {
  periodStart: Date | null;
  totalUsd: number | null;
  messagesUsd: number | null;
  accountsUsd: number | null;
  prevTotalUsd: number | null;
  prevPeriodStart: Date | null;
  suspended: boolean;
  declineReason: string | null;
  openInvoice: boolean;
  fetchedAt: Date | null;
  lastError: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function billingAlertFor(row: Pick<Row, "suspended" | "declineReason" | "openInvoice">): string | null {
  if (row.suspended) {
    return "Zernio suspendió la cuenta: sin Zernio no entran ni salen mensajes. Revisa la tarjeta en el panel de Zernio › Billing.";
  }
  if (row.declineReason || row.openInvoice) {
    return "Zernio marca un pago pendiente: revisa la tarjeta en el panel de Zernio › Billing antes de que suspenda la cuenta.";
  }
  return null;
}

export function summarizeZernio(row: Row, now: Date): ZernioSummary {
  const total = row.totalUsd;
  const parts = (row.messagesUsd ?? 0) + (row.accountsUsd ?? 0);
  return {
    monthLabel: row.periodStart ? monthName.format(row.periodStart) : null,
    totalUsd: total === null ? null : round2(total),
    messagesUsd: row.messagesUsd === null ? null : round2(row.messagesUsd),
    accountsUsd: row.accountsUsd === null ? null : round2(row.accountsUsd),
    otherUsd: total === null ? 0 : Math.max(0, round2(total - parts)),
    prevTotalUsd: row.prevTotalUsd === null ? null : round2(row.prevTotalUsd),
    prevMonthLabel: row.prevPeriodStart ? monthName.format(row.prevPeriodStart) : null,
    billingAlert: billingAlertFor(row),
    updatedMinutesAgo: row.fetchedAt ? Math.max(0, Math.floor((now.getTime() - row.fetchedAt.getTime()) / 60_000)) : null,
    lastError: row.lastError,
  };
}

// null = no hay lectura (sin llave en el worker o aún no corre): la tarjeta no aparece.
export async function zernioSummary(
  database: Database,
  organizationId: string,
  options: { now?: Date } = {},
): Promise<ZernioSummary | null> {
  const [row] = await database.select().from(zernioBilling).where(eq(zernioBilling.organizationId, organizationId));
  if (!row) return null;
  return summarizeZernio(row, options.now ?? new Date());
}

// "Actualizado hace 3 min" / "Sin actualizar desde hace 2 h" / "No se pudo leer de Zernio".
export function zernioFreshness(s: Pick<ZernioSummary, "updatedMinutesAgo" | "lastError">): { text: string; tone: "muted" | "orange" } {
  const m = s.updatedMinutesAgo;
  if (m === null) return { text: s.lastError ? "No se pudo leer de Zernio" : "Aún sin leer", tone: "orange" };
  const ago = m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
  if (m >= ZERNIO_STALE_MINUTES || s.lastError) return { text: `Sin actualizar desde hace ${ago}`, tone: "orange" };
  return { text: `Actualizado hace ${ago}`, tone: "muted" };
}
