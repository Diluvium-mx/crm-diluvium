// Lo que cobró Meta por mensaje, sacado de lo que Meta reporta (meta_whatsapp_pricing; docs/meta-whatsapp.md). Lo
// usan la sección «Gasto de WhatsApp» (costo aproximado por origen) y el ahorro por el celular (ahorro-celular.ts).
import { and, eq, gte, lte } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { metaWhatsappPricing } from "@/lib/db/schema";
import { META_RATE_USD } from "./tarifas";

type Database = Pick<typeof appDb, "select">;

export type MetaPricingRow = { day: string; category: string; pricingType: string; volume: number; costUsd: number | null };

// La tarifa vive en tarifas.ts (sin dependencias, para que la barra del chat la use en el navegador).
export { META_RATE_USD };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// PURO: el costo de un renglón de Meta: los cobrados (regular) × la tarifa de su tipo; los gratis, 0. Un tipo sin
// tarifa conocida queda sin dato.
export function costoDeMeta(p: { category: string; pricingType: string; volume: number }): number | null {
  if (p.pricingType !== "regular") return 0;
  const rate = META_RATE_USD[p.category];
  return rate === undefined ? null : round6(p.volume * rate);
}

// PURO: lo que cobró Meta en promedio por mensaje de cada tipo en esos renglones (o la tarifa si no hubo).
export function ratesFrom(rows: MetaPricingRow[]): Record<string, number> {
  const acc = new Map<string, { volume: number; cost: number }>();
  for (const r of rows) {
    if (r.pricingType !== "regular" || r.costUsd === null || r.volume <= 0) continue;
    const cur = acc.get(r.category) ?? { volume: 0, cost: 0 };
    cur.volume += r.volume;
    cur.cost += r.costUsd;
    acc.set(r.category, cur);
  }
  const rates: Record<string, number> = { ...META_RATE_USD };
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
