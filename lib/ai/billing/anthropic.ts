// Gasto REAL de Anthropic con la llave de administración (ANTHROPIC_ADMIN_KEY), por día UTC y
// separado en producción (espacio de trabajo Default) y pruebas (cualquier otro, hoy "Pruebas").
// Medido el 1-oct-2026 contra la API:
// - El reporte de COSTO (dólares) no trae el día en curso y el de ayer sigue creciendo horas
//   después de medianoche → solo se usa para los días de antes de ayer.
// - El reporte de USO (tokens) en bloques de 1 hora trae solo horas completas; en bloques de
//   1 minuto llega casi al momento (~5 min). Ayer va por horas y hoy por minutos, a precio
//   oficial (tokens × precio = lo que cobró Anthropic, al centavo en las pruebas).
// No hay API del saldo: el saldo es recargas − este gasto (lib/dashboard/ai-spend.ts).
import { z } from "zod";
import { resolveModelPrice } from "@/lib/ai/pricing";
import type { BillingDays } from "@/lib/db/schema/ai-billing";
import { addDays, addToDay, dayStartIso, round8, utcDay } from "./days";
import { getJson, type FetchLike } from "./http";
import type { BillingReading, ReadOptions } from "./types";

const BASE = "https://api.anthropic.com/v1/organizations";
// Días de costo que se vuelven a leer en cada pasada (el reporte se corrige unas horas después).
export const ANTHROPIC_REFRESH_DAYS = 7;
// Día en que se creó el espacio "Pruebas" (1-oct-2026). Antes, producción y pruebas usaban la
// misma llave en Default: en esos días Anthropic no sabe qué fue prueba.
export const ANTHROPIC_PRUEBAS_DESDE = "2026-10-01";
// US$10 por cada 1,000 búsquedas web (precio oficial).
const WEB_SEARCH_USD = 0.01;

const costSchema = z.object({
  data: z.array(
    z.object({
      starting_at: z.string(),
      results: z.array(z.object({ amount: z.string(), workspace_id: z.string().nullish() })),
    }),
  ),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

const usageRowSchema = z.object({
  model: z.string().nullish(),
  workspace_id: z.string().nullish(),
  uncached_input_tokens: z.number(),
  cache_read_input_tokens: z.number(),
  cache_creation: z.object({ ephemeral_5m_input_tokens: z.number().nullish(), ephemeral_1h_input_tokens: z.number().nullish() }).nullish(),
  output_tokens: z.number(),
  server_tool_use: z.object({ web_search_requests: z.number().nullish() }).nullish(),
});
export type AnthropicUsageRow = z.infer<typeof usageRowSchema>;

const usageSchema = z.object({
  data: z.array(z.object({ starting_at: z.string(), results: z.array(usageRowSchema) })),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

// Default (null) = producción; cualquier otro espacio = pruebas.
export function groupOfWorkspace(workspaceId: string | null | undefined): "prod" | "pruebas" {
  return workspaceId ? "pruebas" : "prod";
}

// "claude-haiku-4-5-20251001" → "claude-haiku-4-5" (el id del catálogo, sin fecha).
export function catalogModelId(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

// Costo en USD de una fila del reporte de uso, a precio oficial. null = modelo sin precio en el
// catálogo (no se inventa: se avisa en el log y ese gasto llega por el reporte de costo).
export function usageRowCostUsd(row: AnthropicUsageRow): number | null {
  if (!row.model) return null;
  const price = resolveModelPrice(catalogModelId(row.model), "anthropic", null);
  if (!price) return null;
  const write5m = row.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const write1h = row.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const micro =
    row.uncached_input_tokens * price.inputPerMTok +
    row.cache_read_input_tokens * price.cacheReadPerMTok +
    write5m * price.cacheWritePerMTok +
    // Escritura de 1 hora: 2× la entrada (precio oficial).
    write1h * price.inputPerMTok * 2 +
    row.output_tokens * price.outputPerMTok;
  return round8(micro / 1_000_000 + (row.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD);
}

const headers = (key: string) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" });

async function costDays(fetchImpl: FetchLike, key: string, from: string, toExclusive: string, days: BillingDays) {
  let page: string | null | undefined;
  do {
    const q = new URLSearchParams({ starting_at: dayStartIso(from), ending_at: dayStartIso(toExclusive), limit: "31" });
    q.append("group_by[]", "workspace_id");
    if (page) q.set("page", page);
    const r = costSchema.parse(await getJson(fetchImpl, `${BASE}/cost_report?${q}`, headers(key)));
    for (const b of r.data) {
      // Centavos como texto decimal ("123.45" = US$1.2345).
      for (const row of b.results) addToDay(days, b.starting_at.slice(0, 10), Number(row.amount) / 100, groupOfWorkspace(row.workspace_id));
    }
    page = r.has_more ? r.next_page : null;
  } while (page);
}

async function usageDays(
  fetchImpl: FetchLike,
  key: string,
  bucket: "1h" | "1m",
  startIso: string,
  endIso: string,
  limit: number,
  days: BillingDays,
  unpriced: Set<string>,
) {
  let page: string | null | undefined;
  do {
    const q = new URLSearchParams({ starting_at: startIso, ending_at: endIso, bucket_width: bucket, limit: String(limit) });
    q.append("group_by[]", "workspace_id");
    q.append("group_by[]", "model");
    if (page) q.set("page", page);
    const r = usageSchema.parse(await getJson(fetchImpl, `${BASE}/usage_report/messages?${q}`, headers(key)));
    for (const b of r.data) {
      for (const row of b.results) {
        const usd = usageRowCostUsd(row);
        if (usd === null) {
          unpriced.add(row.model ?? "sin modelo");
          continue;
        }
        addToDay(days, b.starting_at.slice(0, 10), usd, groupOfWorkspace(row.workspace_id));
      }
    }
    page = r.has_more ? r.next_page : null;
  } while (page);
}

function nextMinuteIso(now: Date): string {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function readAnthropicBilling(adminKey: string, opts: ReadOptions): Promise<BillingReading> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const today = utcDay(opts.now);
  const yesterday = addDays(today, -1);
  const refreshFrom = addDays(today, -ANTHROPIC_REFRESH_DAYS);
  // Sin lecturas previas se trae todo desde `fromDay`; después solo la última semana.
  const replaceFrom = opts.hasHistory && opts.fromDay < refreshFrom ? refreshFrom : opts.fromDay;
  const days: BillingDays = {};
  const unpriced = new Set<string>();
  if (replaceFrom < yesterday) await costDays(fetchImpl, adminKey, replaceFrom, yesterday, days);
  const hoursFrom = replaceFrom > yesterday ? replaceFrom : yesterday;
  if (hoursFrom < today) await usageDays(fetchImpl, adminKey, "1h", dayStartIso(hoursFrom), dayStartIso(today), 48, days, unpriced);
  if (replaceFrom <= today) await usageDays(fetchImpl, adminKey, "1m", dayStartIso(today), nextMinuteIso(opts.now), 1440, days, unpriced);
  return {
    days,
    replaceFrom,
    balanceUsd: null,
    loadedUsd: null,
    warnings: unpriced.size ? [`modelos sin precio en el catálogo (su gasto de ayer y hoy llega con el reporte de costo): ${[...unpriced].join(", ")}`] : [],
  };
}
