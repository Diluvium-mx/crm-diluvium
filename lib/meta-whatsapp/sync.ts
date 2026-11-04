// Lectura periódica del cobro de Meta por WhatsApp (worker, cada hora; docs/meta-whatsapp.md). Por cada número de
// WhatsApp conectado por Zernio (sin los de prueba ni los archivados) lee lo que Meta reporta desde el día 1 del mes
// anterior y lo guarda en meta_whatsapp_pricing (un renglón por día UTC, categoría y tipo). Si Zernio falla, se
// guarda el error en meta_whatsapp_pricing_sync y se conservan los renglones de antes.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, metaWhatsappPricing, metaWhatsappPricingSync } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log/safe-error";
import { redactZernioKey, zernioBillingConfigFromEnv, type ZernioBillingConfig } from "@/lib/zernio-billing/read";
import { pricingRange, readMetaPricing, type MetaPricingPoint } from "./read";

export type MetaPricingSyncResult = { ok: boolean; errors: number } | null;

type Reader = (config: ZernioBillingConfig, accountId: string, range: { start: string; end: string }) => Promise<MetaPricingPoint[]>;

export async function syncMetaWhatsappPricing(
  options: { now?: Date; config?: ZernioBillingConfig | null; read?: Reader } = {},
): Promise<MetaPricingSyncResult> {
  const config = options.config === undefined ? zernioBillingConfigFromEnv() : options.config;
  if (!config) return null;
  const now = options.now ?? new Date();
  const read = options.read ?? readMetaPricing;
  const numbers = await db
    .select({ id: channels.id, organizationId: channels.organizationId, accountId: channels.providerAccountId })
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.type, "whatsapp"), eq(channels.isTest, false), isNull(channels.archivedAt)));
  if (numbers.length === 0) return null;

  const range = pricingRange(now);
  const failedOrgs = new Map<string, string>();
  for (const channel of numbers) {
    let points: MetaPricingPoint[];
    try {
      points = await read(config, channel.accountId, range);
    } catch (error) {
      const message = redactZernioKey(safeErrorMessage(error), config.apiKey).slice(0, 500);
      failedOrgs.set(channel.organizationId, message);
      console.warn(`[meta-cobro] no se pudo leer el cobro de Meta (se quedan los datos de antes): ${message}`);
      continue;
    }
    for (const p of points) {
      await db
        .insert(metaWhatsappPricing)
        .values({ organizationId: channel.organizationId, channelId: channel.id, ...p, fetchedAt: now })
        .onConflictDoUpdate({
          target: [
            metaWhatsappPricing.organizationId,
            metaWhatsappPricing.channelId,
            metaWhatsappPricing.day,
            metaWhatsappPricing.category,
            metaWhatsappPricing.pricingType,
          ],
          set: { volume: p.volume, costUsd: p.costUsd, fetchedAt: now },
        });
    }
  }

  for (const org of new Set(numbers.map((n) => n.organizationId))) {
    const lastError = failedOrgs.get(org) ?? null;
    const set = lastError ? { attemptedAt: now, lastError } : { attemptedAt: now, fetchedAt: now, lastError: null };
    await db
      .insert(metaWhatsappPricingSync)
      .values({ organizationId: org, ...set })
      .onConflictDoUpdate({ target: metaWhatsappPricingSync.organizationId, set });
  }
  return { ok: failedOrgs.size === 0, errors: failedOrgs.size };
}
