// Lectura periódica del cobro de Railway (worker, cada 5 min). Con RAILWAY_BILLING_TOKEN lee el
// workspace del proyecto y guarda la lectura en railway_billing para cada organización (el token es
// del despliegue: todas ven la misma cuenta de Railway). Si Railway falla, se guarda el error y se
// conserva la última lectura buena.
import { db } from "@/lib/db";
import { organization, railwayBilling } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log/safe-error";
import { railwayBillingConfigFromEnv, readRailwayBilling, redactRailwayToken, type RailwayBillingConfig, type RailwayReading } from "./read";

export type RailwaySyncResult = { ok: boolean; error?: string } | null;

export async function syncRailwayBilling(
  options: {
    now?: Date;
    config?: RailwayBillingConfig | null;
    read?: (config: RailwayBillingConfig) => Promise<RailwayReading>;
  } = {},
): Promise<RailwaySyncResult> {
  const config = options.config === undefined ? railwayBillingConfigFromEnv() : options.config;
  if (!config) return null;
  const now = options.now ?? new Date();
  const orgs = (await db.select({ id: organization.id }).from(organization)).map((o) => o.id);
  if (orgs.length === 0) return null;

  let reading: RailwayReading;
  try {
    reading = await (options.read ?? readRailwayBilling)(config);
  } catch (error) {
    const message = redactRailwayToken(safeErrorMessage(error), config.token).slice(0, 500);
    for (const org of orgs) {
      await db
        .insert(railwayBilling)
        // Aún sin lectura buena no se sabe el workspace: queda vacío hasta la primera.
        .values({ organizationId: org, workspaceId: "", attemptedAt: now, lastError: message })
        .onConflictDoUpdate({ target: railwayBilling.organizationId, set: { attemptedAt: now, lastError: message } });
    }
    console.warn(`[railway] no se pudo leer el cobro (se queda la última lectura): ${message}`);
    return { ok: false, error: message };
  }

  const values = { ...reading, fetchedAt: now, attemptedAt: now, lastError: null };
  for (const org of orgs) {
    await db
      .insert(railwayBilling)
      .values({ organizationId: org, ...values })
      .onConflictDoUpdate({ target: railwayBilling.organizationId, set: values });
  }
  return { ok: true };
}
