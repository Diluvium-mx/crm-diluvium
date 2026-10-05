// Cobro de Meta por WhatsApp (5-oct-2026): lee el reporte `pricing_analytics` de la cuenta de
// WhatsApp (WABA) por día, tipo de precio y categoría. Solo LEE: no manda nada ni cuesta nada.
//
// Token: META_WHATSAPP_TOKEN (usuario del sistema del portafolio «Grupo Diluvium» con solo
// `whatsapp_business_management` y la WABA asignada). META_WABA_ID = id de la WABA. Ambos solo en
// el worker. Va en el encabezado Authorization, nunca en la URL. Detalle: docs/meta-costos.md.
import { META_GRAPH_VERSION_DEFAULT, graphGet, type MetaApiConfig } from "@/lib/ads/meta-api";
import { addDays, utcDay } from "@/lib/ai/billing/days";
import type { MetaPricingDays } from "@/lib/db/schema/meta-billing";

export type MetaBillingConfig = { api: MetaApiConfig; wabaId: string };

// null = falta el token o el id: el worker no lee nada y la tarjeta no aparece.
export function metaBillingConfigFromEnv(env: Record<string, string | undefined> = process.env): MetaBillingConfig | null {
  const token = env.META_WHATSAPP_TOKEN?.trim();
  const wabaId = env.META_WABA_ID?.trim();
  if (!token || !wabaId || !/^\d{1,25}$/.test(wabaId)) return null;
  const version = env.META_GRAPH_API_VERSION?.trim();
  return {
    wabaId,
    api: {
      token,
      version: version && /^v\d{1,3}\.\d$/.test(version) ? version : META_GRAPH_VERSION_DEFAULT,
      appSecret: env.META_APP_SECRET?.trim() || undefined,
    },
  };
}

export type MetaPricingReading = { currency: string | null; days: MetaPricingDays };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function label(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,40}$/.test(value) ? value : fallback;
}

// PURO: respuesta de la Graph API → días UTC. Meta manda `pricing_analytics.data[].data_points[]`
// con `start` (unix), `volume`, `cost`, `pricing_type` y `pricing_category`.
export function parsePricingAnalytics(json: Record<string, unknown>): MetaPricingReading {
  const currency = typeof json.currency === "string" && /^[A-Z]{3}$/.test(json.currency) ? json.currency : null;
  const days: MetaPricingDays = {};
  const pa = json.pricing_analytics as { data?: unknown } | undefined;
  const groups = Array.isArray(pa?.data) ? pa.data : [];
  for (const group of groups) {
    const points = (group as { data_points?: unknown })?.data_points;
    if (!Array.isArray(points)) continue;
    for (const raw of points) {
      const p = raw as Record<string, unknown>;
      const start = num(p.start);
      if (!start) continue;
      const day = utcDay(new Date(start * 1000));
      const type = label(p.pricing_type, "SIN_TIPO");
      const category = label(p.pricing_category, "SIN_CATEGORIA");
      const volume = num(p.volume);
      const cost = num(p.cost);
      if (!volume && !cost) continue;
      const byType = (days[day] ??= {});
      const byCat = (byType[type] ??= {});
      const cell = (byCat[category] ??= { volume: 0, cost: 0 });
      cell.volume += volume;
      cell.cost = round6(cell.cost + cost);
    }
  }
  return { currency, days };
}

// Lee del día `fromDay` (UTC) a hoy, por día. Una sola llamada.
export async function readMetaPricing(config: MetaBillingConfig, opts: { now: Date; fromDay: string }): Promise<MetaPricingReading> {
  const start = Math.floor(new Date(`${opts.fromDay}T00:00:00Z`).getTime() / 1000);
  const end = Math.floor(new Date(`${addDays(utcDay(opts.now), 1)}T00:00:00Z`).getTime() / 1000);
  const field =
    `pricing_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    `.dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`;
  const json = await graphGet(config.api, config.wabaId, { fields: `currency,${field}` });
  return parsePricingAnalytics(json);
}
