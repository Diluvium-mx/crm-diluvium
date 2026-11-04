// Cobro de Meta por WhatsApp (4-nov-2026; docs/meta-whatsapp.md): lo que Meta reporta para el número, leído de
// Zernio (`GET /v1/whatsapp/pricing-analytics`, que lo toma en vivo de `pricing_analytics` de la cuenta de
// WhatsApp). Va con la misma ZERNIO_API_KEY de los mensajes: no necesita el token de Meta. Solo LEE: no cambia
// nada ni cuesta nada. Por día UTC, categoría (marketing, utility, service…) y tipo de precio (regular = cobrado,
// free_entry_point = gratis por anuncio, free_customer_service = gratis de servicio).
import { z } from "zod";
import { getJson, type GetLike, type ZernioBillingConfig } from "@/lib/zernio-billing/read";

export type MetaPricingPoint = { day: string; category: string; pricingType: string; volume: number; costUsd: number | null };

// Sin dato de Meta para la categoría o el tipo.
export const UNKNOWN = "desconocida";

const pointSchema = z
  .object({
    start: z.string(),
    pricingCategory: z.string().nullish(),
    pricingType: z.string().nullish(),
    volume: z.number().nullish(),
    cost: z.number().nullish(),
  })
  .passthrough();

const responseSchema = z.object({ dataPoints: z.array(pointSchema) }).passthrough();

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function word(value: string | null | undefined): string {
  const text = value?.trim().toLowerCase();
  return text ? text.slice(0, 64) : UNKNOWN;
}

// PURO: respuesta de Zernio → un renglón por (día UTC, categoría, tipo). Si Meta parte un mismo renglón (por
// país o nivel de precio), se suman.
export function parseMetaPricing(json: unknown): MetaPricingPoint[] {
  const byKey = new Map<string, MetaPricingPoint>();
  for (const p of responseSchema.parse(json).dataPoints) {
    const start = new Date(p.start);
    if (Number.isNaN(start.getTime())) continue;
    const day = start.toISOString().slice(0, 10);
    const category = word(p.pricingCategory);
    const pricingType = word(p.pricingType);
    const volume = typeof p.volume === "number" && Number.isFinite(p.volume) ? Math.max(0, Math.round(p.volume)) : 0;
    const cost = typeof p.cost === "number" && Number.isFinite(p.cost) ? p.cost : null;
    const key = `${day}|${category}|${pricingType}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { day, category, pricingType, volume, costUsd: cost === null ? null : round6(cost) });
      continue;
    }
    prev.volume += volume;
    if (cost !== null) prev.costUsd = round6((prev.costUsd ?? 0) + cost);
  }
  return [...byKey.values()];
}

// Desde el día 1 del mes anterior (UTC): el mes que se va a cobrar queda completo aunque Meta corrija tarde.
export function pricingRange(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { start: start.toISOString().slice(0, 10), end: now.toISOString() };
}

export async function readMetaPricing(
  config: ZernioBillingConfig,
  accountId: string,
  range: { start: string; end: string },
  options: { fetchImpl?: GetLike } = {},
): Promise<MetaPricingPoint[]> {
  const query = new URLSearchParams({
    accountId,
    start: range.start,
    end: range.end,
    granularity: "DAILY",
    dimensions: "PRICING_CATEGORY,PRICING_TYPE",
    metricTypes: "COST,VOLUME",
  });
  return parseMetaPricing(await getJson(config, `/v1/whatsapp/pricing-analytics?${query}`, options.fetchImpl ?? fetch));
}
