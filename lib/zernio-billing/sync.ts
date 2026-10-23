// Lectura periódica del cobro de Zernio (worker, cada 15 min). Con ZERNIO_API_KEY lee el consumo
// del mes y el estado del cobro y guarda la lectura en zernio_billing para cada organización (la
// llave es del despliegue: todas ven la misma cuenta de Zernio). Si Zernio falla, se guarda el
// error y se conserva la última lectura buena.
import { db } from "@/lib/db";
import { organization, zernioBilling } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log/safe-error";
import { readZernioBilling, redactZernioKey, zernioBillingConfigFromEnv, type ZernioBillingConfig, type ZernioReading } from "./read";

export type ZernioSyncResult = { ok: boolean; error?: string } | null;

export async function syncZernioBilling(
  options: {
    now?: Date;
    config?: ZernioBillingConfig | null;
    read?: (config: ZernioBillingConfig) => Promise<ZernioReading>;
  } = {},
): Promise<ZernioSyncResult> {
  const config = options.config === undefined ? zernioBillingConfigFromEnv() : options.config;
  if (!config) return null;
  const now = options.now ?? new Date();
  const orgs = (await db.select({ id: organization.id }).from(organization)).map((o) => o.id);
  if (orgs.length === 0) return null;

  let reading: ZernioReading;
  try {
    reading = await (options.read ?? readZernioBilling)(config);
  } catch (error) {
    const message = redactZernioKey(safeErrorMessage(error), config.apiKey).slice(0, 500);
    for (const org of orgs) {
      await db
        .insert(zernioBilling)
        .values({ organizationId: org, attemptedAt: now, lastError: message })
        .onConflictDoUpdate({ target: zernioBilling.organizationId, set: { attemptedAt: now, lastError: message } });
    }
    console.warn(`[zernio-cobro] no se pudo leer el cobro (se queda la última lectura): ${message}`);
    return { ok: false, error: message };
  }

  const values = { ...reading, fetchedAt: now, attemptedAt: now, lastError: null };
  for (const org of orgs) {
    await db
      .insert(zernioBilling)
      .values({ organizationId: org, ...values })
      .onConflictDoUpdate({ target: zernioBilling.organizationId, set: values });
  }
  return { ok: true };
}
