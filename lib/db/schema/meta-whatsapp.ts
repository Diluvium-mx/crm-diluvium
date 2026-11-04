import { date, integer, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { channels } from "./messaging";

// Cobro de Meta por WhatsApp (4-nov-2026, pedido del dueño; docs/meta-whatsapp.md). El worker lee cada hora
// de Zernio lo que Meta reporta para el número (`GET /v1/whatsapp/pricing-analytics`: mensajes y costo por
// día, categoría y tipo de precio) y guarda aquí un renglón por día UTC, canal, categoría y tipo. Es la misma
// cifra que «Precios de mensajes» de WhatsApp Manager; Meta cobra el día 1 a la tarjeta, sin IVA.
export const metaWhatsappPricing = pgTable(
  "meta_whatsapp_pricing",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    // marketing · utility · service · authentication… y regular · free_entry_point · free_customer_service
    // (minúsculas). Sin dato de Meta: «desconocida».
    category: text("category").notNull(),
    pricingType: text("pricing_type").notNull(),
    volume: integer("volume").notNull().default(0),
    // Dólares (la moneda de la tarjeta de la cuenta de WhatsApp). null = Meta no dio el costo.
    costUsd: numeric("cost_usd", { precision: 14, scale: 6, mode: "number" }),
    fetchedAt: timestamp("fetched_at").notNull(),
  },
  (table) => [
    primaryKey({ name: "meta_whatsapp_pricing_pk", columns: [table.organizationId, table.channelId, table.day, table.category, table.pricingType] }),
  ],
);

// Última lectura del cobro de Meta por organización: si Zernio falla se guarda el error (sin la llave) y se
// conservan los renglones de antes.
export const metaWhatsappPricingSync = pgTable("meta_whatsapp_pricing_sync", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  fetchedAt: timestamp("fetched_at"),
  attemptedAt: timestamp("attempted_at").notNull(),
  lastError: text("last_error"),
});
