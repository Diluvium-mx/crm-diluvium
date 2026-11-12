// Lo que cobró Meta por mensaje, sacado de lo que Meta reporta (meta_whatsapp_pricing; docs/meta-whatsapp.md). Lo
// usan la sección «Gasto de WhatsApp» (costo aproximado por origen) y el ahorro por el celular (ahorro-celular.ts).
import { and, eq, gte, lte } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { metaWhatsappPricing } from "@/lib/db/schema";

type Database = Pick<typeof appDb, "select">;

export type MetaPricingRow = { day: string; category: string; pricingType: string; volume: number; costUsd: number | null };

// Lo que cobró Meta por mensaje en oct-2026 (factura del 1-nov, sin IVA). Solo si en el periodo no hay mensajes
// cobrados de ese tipo para sacar el promedio real.
export const META_FALLBACK_RATE_USD: Record<string, number> = { marketing: 0.0407, utility: 0.0084, service: 0.0115 };

// PURO: lo que cobró Meta en promedio por mensaje de cada tipo en esos renglones (o el de octubre si no hubo).
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

// Renglones de lo que reportó Meta entre dos días UTC (inclusivos).
export async function loadPricingRows(database: Database, organizationId: string, desde: string, hasta: string): Promise<MetaPricingRow[]> {
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
