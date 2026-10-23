import { boolean, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Cobro de Zernio (23-oct-2026, pedido del dueño: «todos los datos en un mismo lugar»). El worker lee
// cada 15 min el consumo del mes de Zernio (`GET /v1/usage`, mismo detalle que la factura) y el
// estado del cobro (`GET /v1/billing`) con ZERNIO_API_KEY, y guarda aquí la última lectura buena.
// Una fila por organización (la llave es del despliegue: todas ven la misma cuenta de Zernio).
// Si Zernio falla se guarda el error y se conserva lo anterior. Detalle: docs/zernio-costos.md.
export const zernioBilling = pgTable("zernio_billing", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  // Mes de cobro de Zernio (días UTC, del 1.º al 1.º del mes siguiente).
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  // Lo que va del mes (ya con el crédito gratis aplicado) y sus partes.
  totalUsd: numeric("total_usd", { precision: 14, scale: 6, mode: "number" }),
  messagesUsd: numeric("messages_usd", { precision: 14, scale: 6, mode: "number" }),
  accountsUsd: numeric("accounts_usd", { precision: 14, scale: 6, mode: "number" }),
  // Lo que cobró el mes anterior (null si Zernio no lo da).
  prevTotalUsd: numeric("prev_total_usd", { precision: 14, scale: 6, mode: "number" }),
  prevPeriodStart: timestamp("prev_period_start"),
  // Estado del cobro: cuenta suspendida, tarjeta rechazada o factura abierta → aviso naranja.
  suspended: boolean("suspended").notNull().default(false),
  declineReason: text("decline_reason"),
  openInvoice: boolean("open_invoice").notNull().default(false),
  fetchedAt: timestamp("fetched_at"),
  attemptedAt: timestamp("attempted_at").notNull(),
  lastError: text("last_error"),
});
