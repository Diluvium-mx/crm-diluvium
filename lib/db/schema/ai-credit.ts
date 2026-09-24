import { sql } from "drizzle-orm";
import { date, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// Recargas de crédito de los proveedores de IA (Dashboard, 24-sep-2026). Ni OpenAI ni
// Anthropic dan el saldo por API (docs/investigacion/gasto-ia-saldo.md): el saldo es
// un ESTIMADO = recargas − gasto (ai_usage.cost_usd) desde la primera recarga. Solo
// owner/admin las registran. Monto NETO en USD (sin impuestos).
export const aiCreditTopups = pgTable(
  "ai_credit_topups",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Proveedor del catálogo (openai | anthropic | google | xai | openrouter).
    provider: text("provider").notNull(),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 2, mode: "number" }).notNull(),
    // Día de la recarga (hora de Mazatlán): el gasto cuenta desde ese día.
    toppedUpOn: date("topped_up_on", { mode: "string" }).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("ai_credit_topups_org_provider_idx").on(table.organizationId, table.provider, sql`${table.toppedUpOn} desc`)],
);
