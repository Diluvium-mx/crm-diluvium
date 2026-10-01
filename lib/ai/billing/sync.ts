// Lectura periódica del gasto REAL de los proveedores de IA (worker, cada 5 min). Por cada
// proveedor con su llave de administración en el entorno, lee sus reportes de cobro y guarda la
// lectura en ai_provider_billing para cada organización (las llaves son del despliegue, así que
// todas ven la misma cuenta del proveedor). Leer reportes no llama a ningún modelo ni gasta saldo.
// Si un proveedor falla, se guarda el error y se conserva su última lectura buena.
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiCreditTopups, aiProviderBilling, organization } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log/safe-error";
import { ANTHROPIC_PRUEBAS_DESDE, readAnthropicBilling } from "./anthropic";
import { addDays, mergeDays, monthStartUtc, utcDay } from "./days";
import { redactKeys, type FetchLike } from "./http";
import { readOpenAiBilling } from "./openai";
import { readOpenRouterBilling } from "./openrouter";
import type { BillingProvider, BillingReading, ReadOptions } from "./types";
import { readXaiBilling } from "./xai";

export type BillingSource = { provider: BillingProvider; read: (opts: ReadOptions) => Promise<BillingReading> };

// Variables de entorno (solo en el worker): ANTHROPIC_ADMIN_KEY, OPENAI_ADMIN_KEY,
// XAI_MANAGEMENT_KEY + XAI_TEAM_ID y OPENROUTER_MANAGEMENT_KEY. Sin ellas, ese proveedor sigue
// con el saldo estimado de siempre.
export function billingSources(env: Record<string, string | undefined> = process.env): BillingSource[] {
  const out: BillingSource[] = [];
  const anthropic = env.ANTHROPIC_ADMIN_KEY;
  if (anthropic) out.push({ provider: "anthropic", read: (o) => readAnthropicBilling(anthropic, o) });
  const openai = env.OPENAI_ADMIN_KEY;
  if (openai) out.push({ provider: "openai", read: (o) => readOpenAiBilling(openai, o) });
  const xai = env.XAI_MANAGEMENT_KEY;
  const team = env.XAI_TEAM_ID;
  if (xai && team) out.push({ provider: "xai", read: (o) => readXaiBilling(xai, team, o) });
  const openrouter = env.OPENROUTER_MANAGEMENT_KEY;
  if (openrouter) out.push({ provider: "openrouter", read: (o) => readOpenRouterBilling(openrouter, o) });
  return out;
}

// Diferencia tolerada entre lo que cobró Anthropic en producción y lo que calculó el CRM.
const CHECK_MIN_USD = 0.02;
const CHECK_PCT = 0.03;
// Cada diferencia se avisa una sola vez por proceso (la lectura corre cada 5 min).
const warnedChecks = new Set<string>();

// Gasto de producción que registró el CRM por día UTC (para la verificación diaria).
async function crmDaysUtc(organizationId: string, provider: string, from: string): Promise<Map<string, number>> {
  const rows = await db.execute<{ day: string; usd: string | null }>(sql`
    select to_char(created_at, 'YYYY-MM-DD') as day, sum(cost_usd)::text as usd
    from ai_usage
    where organization_id = ${organizationId} and provider = ${provider}
      and created_at >= ${from}::date
    group by 1
  `);
  return new Map(rows.map((r) => [r.day, Number(r.usd ?? 0)]));
}

export type SyncResult = { provider: BillingProvider; ok: boolean; error?: string; warnings: string[] };

export async function syncAiBilling(
  options: { now?: Date; sources?: BillingSource[]; fetchImpl?: FetchLike } = {},
): Promise<SyncResult[]> {
  const now = options.now ?? new Date();
  const sources = options.sources ?? billingSources();
  if (sources.length === 0) return [];
  const orgs = (await db.select({ id: organization.id }).from(organization)).map((o) => o.id);
  if (orgs.length === 0) return [];
  const firstTopups = await db
    .select({ provider: aiCreditTopups.provider, first: sql<string>`to_char(min(${aiCreditTopups.toppedUpOn}), 'YYYY-MM-DD')` })
    .from(aiCreditTopups)
    .groupBy(aiCreditTopups.provider);
  const results: SyncResult[] = [];

  for (const source of sources) {
    const stored = await db.select().from(aiProviderBilling).where(eq(aiProviderBilling.provider, source.provider));
    const storedBy = new Map(stored.map((r) => [r.organizationId, r]));
    const first = firstTopups.find((t) => t.provider === source.provider)?.first;
    const monthStart = monthStartUtc(now);
    const fromDay = first && first < monthStart ? first : monthStart;
    const hasHistory = orgs.every((o) => storedBy.get(o)?.fetchedAt);
    let reading: BillingReading;
    try {
      reading = await source.read({ now, fromDay, hasHistory, fetchImpl: options.fetchImpl });
    } catch (error) {
      // Por si un error trajera una llave (no debería: van en cabeceras), se oculta antes de guardarlo.
      const message = redactKeys(safeErrorMessage(error)).slice(0, 500);
      for (const org of orgs) {
        await db
          .insert(aiProviderBilling)
          .values({ organizationId: org, provider: source.provider, attemptedAt: now, lastError: message })
          .onConflictDoUpdate({
            target: [aiProviderBilling.organizationId, aiProviderBilling.provider],
            set: { attemptedAt: now, lastError: message },
          });
      }
      console.warn(`[gasto-ia] ${source.provider}: no se pudo leer el cobro real (se queda la última lectura): ${message}`);
      results.push({ provider: source.provider, ok: false, error: message, warnings: [] });
      continue;
    }

    for (const org of orgs) {
      const days = mergeDays(storedBy.get(org)?.days ?? {}, reading.days, reading.replaceFrom);
      const values = {
        days,
        balanceUsd: reading.balanceUsd,
        loadedUsd: reading.loadedUsd,
        fetchedAt: now,
        attemptedAt: now,
        lastError: null,
      };
      await db
        .insert(aiProviderBilling)
        .values({ organizationId: org, provider: source.provider, ...values })
        .onConflictDoUpdate({ target: [aiProviderBilling.organizationId, aiProviderBilling.provider], set: values });
    }

    const warnings = [...reading.warnings];
    // Verificación diaria (una sola organización = una sola cuenta): lo que Anthropic cobró en
    // producción contra lo que calculó el CRM, de ayer hacia atrás (días ya completos).
    if (source.provider === "anthropic" && orgs.length === 1) {
      const yesterday = addDays(utcDay(now), -1);
      const weekAgo = addDays(utcDay(now), -7);
      const from = weekAgo > ANTHROPIC_PRUEBAS_DESDE ? weekAgo : ANTHROPIC_PRUEBAS_DESDE;
      const crm = await crmDaysUtc(orgs[0], "anthropic", from);
      for (const [day, v] of Object.entries(reading.days)) {
        if (day < from || day > yesterday) continue;
        const real = v.prod ?? 0;
        const ours = crm.get(day) ?? 0;
        const key = `${day}:${real.toFixed(2)}:${ours.toFixed(2)}`;
        if (Math.abs(real - ours) > Math.max(CHECK_MIN_USD, real * CHECK_PCT) && !warnedChecks.has(key)) {
          warnedChecks.add(key);
          warnings.push(`el ${day} Anthropic cobró US$${real.toFixed(4)} en producción y el CRM calculó US$${ours.toFixed(4)}: revisar precios`);
        }
      }
    }
    for (const w of warnings) console.warn(`[gasto-ia] ${source.provider}: ${w}`);
    results.push({ provider: source.provider, ok: true, warnings });
  }
  return results;
}
