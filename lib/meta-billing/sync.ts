// Lectura periódica del cobro de Meta por WhatsApp (worker, cada hora). Con META_WHATSAPP_TOKEN y
// META_WABA_ID lee pricing_analytics desde el 1.º del mes anterior y guarda la lectura en
// meta_whatsapp_billing para cada organización (el token es del despliegue: todas ven la misma
// WABA). Si Meta falla, se guarda el error y se conserva la última lectura buena.
import { db } from "@/lib/db";
import { metaWhatsappBilling, organization } from "@/lib/db/schema";
import { MetaApiError } from "@/lib/ads/meta-api";
import { safeErrorMessage } from "@/lib/log/safe-error";
import { mergePricingDays, previousMonthStart } from "./days";
import { metaBillingConfigFromEnv, readMetaPricing, type MetaBillingConfig, type MetaPricingReading } from "./read";

// Quita cualquier cosa con forma de token de Meta (EAA…) de un texto de error.
function redactToken(text: string): string {
  return text.replace(/\bEAA[A-Za-z0-9]{10,}/g, "[token oculto]");
}

export type MetaSyncResult = { ok: boolean; error?: string } | null;

export async function syncMetaBilling(
  options: {
    now?: Date;
    config?: MetaBillingConfig | null;
    read?: (config: MetaBillingConfig, opts: { now: Date; fromDay: string }) => Promise<MetaPricingReading>;
  } = {},
): Promise<MetaSyncResult> {
  const config = options.config === undefined ? metaBillingConfigFromEnv() : options.config;
  if (!config) return null;
  const now = options.now ?? new Date();
  const orgs = (await db.select({ id: organization.id }).from(organization)).map((o) => o.id);
  if (orgs.length === 0) return null;
  const fromDay = previousMonthStart(now);

  let reading: MetaPricingReading;
  try {
    reading = await (options.read ?? readMetaPricing)(config, { now, fromDay });
  } catch (error) {
    const base = error instanceof MetaApiError ? error.message : safeErrorMessage(error);
    const message = redactToken(base).slice(0, 500);
    for (const org of orgs) {
      await db
        .insert(metaWhatsappBilling)
        .values({ organizationId: org, wabaId: config.wabaId, attemptedAt: now, lastError: message })
        .onConflictDoUpdate({ target: metaWhatsappBilling.organizationId, set: { wabaId: config.wabaId, attemptedAt: now, lastError: message } });
    }
    console.warn(`[meta-whatsapp] no se pudo leer el cobro (se queda la última lectura): ${message}`);
    return { ok: false, error: message };
  }

  const stored = await db.select().from(metaWhatsappBilling);
  const storedBy = new Map(stored.map((r) => [r.organizationId, r]));
  for (const org of orgs) {
    const prev = storedBy.get(org);
    // Otra WABA = otra cuenta: no se mezcla con lo guardado.
    const keep = prev && prev.wabaId === config.wabaId ? prev.days : {};
    const values = {
      wabaId: config.wabaId,
      currency: reading.currency ?? prev?.currency ?? null,
      days: mergePricingDays(keep, reading.days, fromDay),
      fetchedAt: now,
      attemptedAt: now,
      lastError: null,
    };
    await db
      .insert(metaWhatsappBilling)
      .values({ organizationId: org, ...values })
      .onConflictDoUpdate({ target: metaWhatsappBilling.organizationId, set: values });
  }
  return { ok: true };
}
