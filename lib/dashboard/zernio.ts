// Resumen de la tarjeta «Zernio» del Dashboard (23-oct-2026): lo que va del mes de Zernio (mensajes
// y cuentas conectadas), lo del mes anterior y un aviso si Zernio marca un problema de pago. Sale de
// zernio_billing (lo lee el worker cada 15 min: lib/zernio-billing/sync.ts). Desde el 2-nov-2026 también
// la factura estimada del mes y cuántos mensajes van de los 10,000 gratis, contados en la base (Zernio
// solo da dinero, y es $0 hasta pasar los gratis). `summarizeZernio` y `estimateZernioBill` son PURAS;
// `zernioSummary` solo carga la fila y el conteo.
import { and, count, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { messages, zernioBilling } from "@/lib/db/schema";

type Database = Pick<typeof appDb, "select">;

// Se lee cada 15 min: más de 45 sin lectura buena ya es raro.
export const ZERNIO_STALE_MINUTES = 45;

// Precio de los mensajes (docs.zernio.com/pricing/messages, 2-nov-2026): los primeros 10,000 del mes
// gratis y luego US$0.0001 cada uno. Calibrado con la factura de octubre (docs/zernio-costos.md).
export const ZERNIO_FREE_MESSAGES = 10_000;
export const ZERNIO_USD_PER_MESSAGE = 0.0001;

// Como en Railway: el primer día no se proyecta (un par de horas no dicen el ritmo del mes).
const MIN_HOURS_FOR_ESTIMATE = 24;

// Zernio cobra por mes calendario en días UTC: el nombre del mes sale en UTC.
const monthName = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", month: "long" });

export type ZernioSummary = {
  monthLabel: string | null;
  totalUsd: number | null;
  messagesUsd: number | null;
  accountsUsd: number | null;
  // Otros conceptos de la factura (números, llamadas, SMS…): solo se muestran si cobran algo.
  otherUsd: number;
  // Mensajes que van del mes (contados en la base) y la factura del mes si siguen a este ritmo.
  // null = sin periodo, o el primer día del mes (aún no se proyecta).
  sentCount: number | null;
  freePct: number | null;
  estimatedBillUsd: number | null;
  prevTotalUsd: number | null;
  prevMonthLabel: string | null;
  // Aviso naranja si Zernio suspendió la cuenta o tiene un pago pendiente. null = al corriente.
  billingAlert: string | null;
  updatedMinutesAgo: number | null;
  lastError: string | null;
};

type Row = {
  periodStart: Date | null;
  periodEnd: Date | null;
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

// PURA: factura del mes si los mensajes siguen al ritmo de estos días. Lo que no son mensajes (cuentas
// fuera del crédito, otros cargos) se toma como va; los mensajes, nunca menos de lo que Zernio ya cobra.
export function estimateZernioBill(
  row: Pick<Row, "periodStart" | "periodEnd" | "totalUsd" | "messagesUsd">,
  sentCount: number | null,
  now: Date,
): number | null {
  if (!row.periodStart || !row.periodEnd || row.totalUsd === null || sentCount === null) return null;
  const total = row.periodEnd.getTime() - row.periodStart.getTime();
  const elapsed = Math.min(total, now.getTime() - row.periodStart.getTime());
  if (total <= 0 || elapsed < MIN_HOURS_FOR_ESTIMATE * 3_600_000) return null;
  const messagesUsd = row.messagesUsd ?? 0;
  const projectedSent = (sentCount * total) / elapsed;
  const projectedMessagesUsd = Math.max(0, projectedSent - ZERNIO_FREE_MESSAGES) * ZERNIO_USD_PER_MESSAGE;
  return round2(Math.max(0, row.totalUsd - messagesUsd) + Math.max(messagesUsd, projectedMessagesUsd));
}

export function summarizeZernio(row: Row, now: Date, sentCount: number | null = null): ZernioSummary {
  const total = row.totalUsd;
  const parts = (row.messagesUsd ?? 0) + (row.accountsUsd ?? 0);
  return {
    monthLabel: row.periodStart ? monthName.format(row.periodStart) : null,
    totalUsd: total === null ? null : round2(total),
    messagesUsd: row.messagesUsd === null ? null : round2(row.messagesUsd),
    accountsUsd: row.accountsUsd === null ? null : round2(row.accountsUsd),
    otherUsd: total === null ? 0 : Math.max(0, round2(total - parts)),
    sentCount,
    freePct: sentCount === null ? null : Math.min(100, (sentCount / ZERNIO_FREE_MESSAGES) * 100),
    estimatedBillUsd: estimateZernioBill(row, sentCount, now),
    prevTotalUsd: row.prevTotalUsd === null ? null : round2(row.prevTotalUsd),
    prevMonthLabel: row.prevPeriodStart ? monthName.format(row.prevPeriodStart) : null,
    billingAlert: billingAlertFor(row),
    updatedMinutesAgo: row.fetchedAt ? Math.max(0, Math.floor((now.getTime() - row.fetchedAt.getTime()) / 60_000)) : null,
    lastError: row.lastError,
  };
}

// Lo que Zernio cuenta como mensaje: lo que el CRM manda por su API (vendedor desde el CRM y Agente IA,
// con workflows y seguimientos), WhatsApp e Instagram. No cuentan los fallidos, los entrantes, los ecos
// del celular (`business_app`, `other_api`) ni lo importado. Octubre 2026: 20,737 aquí contra ≈20,800 en
// Zernio (US$1.05 + 0.03 que anotó el 1-nov).
export async function countZernioSent(database: Database, organizationId: string, from: Date, to: Date): Promise<number> {
  const [row] = await database
    .select({ n: count() })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.direction, "out"),
        inArray(messages.source, ["crm", "ai_agent"]),
        ne(messages.status, "failed"),
        isNull(messages.importedAt),
        gte(messages.createdAt, from),
        lt(messages.createdAt, to),
      ),
    );
  return Number(row?.n ?? 0);
}

// null = no hay lectura (sin llave en el worker o aún no corre): la tarjeta no aparece.
export async function zernioSummary(
  database: Database,
  organizationId: string,
  options: { now?: Date } = {},
): Promise<ZernioSummary | null> {
  const [row] = await database.select().from(zernioBilling).where(eq(zernioBilling.organizationId, organizationId));
  if (!row) return null;
  const sentCount =
    row.periodStart && row.periodEnd ? await countZernioSent(database, organizationId, row.periodStart, row.periodEnd) : null;
  return summarizeZernio(row, options.now ?? new Date(), sentCount);
}

// "Actualizado hace 3 min" / "Sin actualizar desde hace 2 h" / "No se pudo leer de Zernio".
export function zernioFreshness(s: Pick<ZernioSummary, "updatedMinutesAgo" | "lastError">): { text: string; tone: "muted" | "orange" } {
  const m = s.updatedMinutesAgo;
  if (m === null) return { text: s.lastError ? "No se pudo leer de Zernio" : "Aún sin leer", tone: "orange" };
  const ago = m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
  if (m >= ZERNIO_STALE_MINUTES || s.lastError) return { text: `Sin actualizar desde hace ${ago}`, tone: "orange" };
  return { text: `Actualizado hace ${ago}`, tone: "muted" };
}
