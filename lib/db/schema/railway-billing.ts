import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Cobro de Railway (7-oct-2026, decisión del dueño): en el plan Hobby ya no hay créditos
// prepagados que ver; el worker lee cada 5 min el cobro del workspace de Railway con
// RAILWAY_BILLING_TOKEN y deja aquí la última lectura buena. El Dashboard lo muestra en la
// tarjeta «Railway» (lib/dashboard/railway.ts). Detalle: docs/railway-costos.md.
export const railwayBilling = pgTable("railway_billing", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  // HOBBY | PRO | FREE, tal como lo da Railway. null si aún no se leyó.
  plan: text("plan"),
  // Estado del cobro (ACTIVE, PAST_DUE, UNPAID…), tal como lo da Railway.
  state: text("state"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  // Uso de recursos del periodo en dólares (Railway avisa que puede venir unos minutos atrasado).
  usageUsd: numeric("usage_usd", { precision: 14, scale: 6, mode: "number" }),
  // Lo que lleva la próxima factura según Railway y su fecha.
  nextInvoiceUsd: numeric("next_invoice_usd", { precision: 14, scale: 6, mode: "number" }),
  nextInvoiceAt: timestamp("next_invoice_at"),
  // Última lectura completa y buena (null = nunca se ha leído bien).
  fetchedAt: timestamp("fetched_at"),
  // Último intento y su error (null si salió bien). El error nunca lleva el token.
  attemptedAt: timestamp("attempted_at").notNull(),
  lastError: text("last_error"),
});
