import { jsonb, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Gasto por día UTC ("YYYY-MM-DD") que REPORTA el proveedor (no el cálculo del CRM).
// `todo` = lo que cobró ese día. `prod`/`pruebas` solo cuando el proveedor separa el gasto
// (Anthropic por espacio de trabajo: Default = producción, el resto = pruebas).
export type BillingDay = { todo: number; prod?: number; pruebas?: number };
export type BillingDays = Record<string, BillingDay>;

// Gasto y saldo REALES de cada proveedor de IA (Dashboard, 1-oct-2026). El worker lee cada 5 min
// los reportes de cobro del proveedor (Anthropic y OpenAI: gasto; xAI y OpenRouter: también el
// saldo) y deja aquí la última lectura buena. El Dashboard junta esto con ai_usage (el registro
// del propio CRM) y con las recargas: lib/dashboard/ai-spend.ts. Detalle:
// docs/investigacion/gasto-ia-saldo.md.
export const aiProviderBilling = pgTable(
  "ai_provider_billing",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // openai | anthropic | xai | openrouter (Google no da su cobro por API).
    provider: text("provider").notNull(),
    days: jsonb("days").$type<BillingDays>().default({}).notNull(),
    // Saldo y total comprado que da el proveedor directo (xAI, OpenRouter); null en los demás.
    balanceUsd: numeric("balance_usd", { precision: 14, scale: 6, mode: "number" }),
    loadedUsd: numeric("loaded_usd", { precision: 14, scale: 6, mode: "number" }),
    // Última lectura completa y buena (null = nunca se ha leído bien).
    fetchedAt: timestamp("fetched_at"),
    // Último intento y su error (null si salió bien). El error nunca lleva la llave.
    attemptedAt: timestamp("attempted_at").notNull(),
    lastError: text("last_error"),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.provider] })],
);
