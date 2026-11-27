import { date, index, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Crédito mensual que trae un plan de suscripción para la API de un proveedor de IA (27-nov-2026, pedido del dueño:
// el plan Max de Claude trae US$100 al mes de créditos de la API de Anthropic). NO es una recarga ni un gasto propio:
// llega cada ciclo, se gasta antes que el saldo comprado y lo que sobra vence al renovarse (no se acumula). El
// Dashboard muestra cuánto queda del ciclo y el saldo comprado deja de bajar mientras quede crédito del plan
// (lib/dashboard/ai-plan-credit.ts). Se da de alta a mano (docs/investigacion/gasto-ia-saldo.md › Crédito del plan).
export const aiPlanCredits = pgTable(
  "ai_plan_credits",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Proveedor del catálogo (hoy solo anthropic).
    provider: text("provider").notNull(),
    // Nombre que se ve: «Plan Max».
    label: text("label").notNull(),
    monthlyUsd: numeric("monthly_usd", { precision: 12, scale: 2, mode: "number" }).notNull(),
    // Día del mes en que se renueva (1–28); el crédito anterior vence ese día.
    renewsDay: integer("renews_day").notNull(),
    // Día (UTC) en que llegó el primer crédito: antes de esa fecha no hay crédito del plan.
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("ai_plan_credits_org_provider_idx").on(table.organizationId, table.provider)],
);
