// Resumen de la tarjeta «WhatsApp (Meta)» del Dashboard (5-oct-2026): lo que Meta va cobrando por
// los mensajes de WhatsApp en el mes (días UTC, igual que su reporte), cuántos fueron gratis y por
// qué. Sale de meta_whatsapp_billing (lo lee el worker cada hora: lib/meta-billing/sync.ts).
// `summarizeMetaWhatsapp` es PURA; `metaWhatsappSummary` solo carga la fila.
import { eq } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { metaWhatsappBilling } from "@/lib/db/schema";
import type { MetaPricingDays } from "@/lib/db/schema/meta-billing";
import { previousMonthStart } from "@/lib/meta-billing/days";

type Database = Pick<typeof appDb, "select">;

// Desde aquí la lectura se considera vieja (el worker lee cada hora).
export const META_STALE_MINUTES = 150;

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  MARKETING_LITE: "Marketing",
  UTILITY: "Utilidad",
  SERVICE: "Servicio (respuestas)",
  AUTHENTICATION: "Autenticación",
  AUTHENTICATION_INTERNATIONAL: "Autenticación",
  REFERRAL_CONVERSION: "Anuncio",
};

export type MetaCategoryRow = { label: string; volume: number; cost: number };

export type MetaWhatsappSummary = {
  monthLabel: string;
  currency: string;
  monthCost: number;
  previousMonthCost: number;
  // Mensajes entregados en el mes.
  charged: number; // REGULAR: los que cuentan para cobro (aunque caigan en los gratis del mes)
  freeAd: number; // FREE_ENTRY_POINT: 72 h gratis por anuncio
  freeService: number; // FREE_CUSTOMER_SERVICE: ventana gratis
  freeOther: number; // otro tipo que Meta agregue
  byCategory: MetaCategoryRow[]; // lo que cuenta para cobro, por categoría
  updatedMinutesAgo: number | null;
  lastError: string | null;
};

type Row = { currency: string | null; days: MetaPricingDays; fetchedAt: Date | null; lastError: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeMetaWhatsapp(row: Row, now: Date): MetaWhatsappSummary {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const prevStart = previousMonthStart(now);
  let monthCost = 0;
  let previousMonthCost = 0;
  let charged = 0;
  let freeAd = 0;
  let freeService = 0;
  let freeOther = 0;
  const cats = new Map<string, MetaCategoryRow>();
  for (const [day, byType] of Object.entries(row.days)) {
    const inMonth = day >= monthStart;
    const inPrev = day >= prevStart && day < monthStart;
    if (!inMonth && !inPrev) continue;
    for (const [type, byCat] of Object.entries(byType)) {
      for (const [cat, cell] of Object.entries(byCat)) {
        if (inPrev) {
          previousMonthCost += cell.cost;
          continue;
        }
        monthCost += cell.cost;
        if (type === "REGULAR") {
          charged += cell.volume;
          const label = CATEGORY_LABELS[cat] ?? cat;
          const cur = cats.get(label) ?? { label, volume: 0, cost: 0 };
          cur.volume += cell.volume;
          cur.cost += cell.cost;
          cats.set(label, cur);
        } else if (type === "FREE_ENTRY_POINT") freeAd += cell.volume;
        else if (type === "FREE_CUSTOMER_SERVICE") freeService += cell.volume;
        else freeOther += cell.volume;
      }
    }
  }
  return {
    monthLabel: new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T12:00:00Z`)),
    currency: row.currency ?? "USD",
    monthCost: round2(monthCost),
    previousMonthCost: round2(previousMonthCost),
    charged,
    freeAd,
    freeService,
    freeOther,
    byCategory: [...cats.values()]
      .map((c) => ({ ...c, cost: round2(c.cost) }))
      .sort((a, b) => b.cost - a.cost || b.volume - a.volume),
    updatedMinutesAgo: row.fetchedAt ? Math.max(0, Math.floor((now.getTime() - row.fetchedAt.getTime()) / 60_000)) : null,
    lastError: row.lastError,
  };
}

// null = no hay lectura (sin token en el worker): la tarjeta no aparece.
export async function metaWhatsappSummary(
  database: Database,
  organizationId: string,
  options: { now?: Date } = {},
): Promise<MetaWhatsappSummary | null> {
  const [row] = await database.select().from(metaWhatsappBilling).where(eq(metaWhatsappBilling.organizationId, organizationId));
  if (!row) return null;
  return summarizeMetaWhatsapp(row, options.now ?? new Date());
}

// "Actualizado hace 12 min" / "Sin actualizar desde hace 3 h" / "Aún sin leer".
export function metaFreshness(s: Pick<MetaWhatsappSummary, "updatedMinutesAgo" | "lastError">): { text: string; tone: "muted" | "orange" } {
  const m = s.updatedMinutesAgo;
  if (m === null) return { text: s.lastError ? "No se pudo leer de Meta" : "Aún sin leer", tone: "orange" };
  const ago = m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
  if (m >= META_STALE_MINUTES || s.lastError) return { text: `Sin actualizar desde hace ${ago}`, tone: "orange" };
  return { text: `Actualizado hace ${ago}`, tone: "muted" };
}
