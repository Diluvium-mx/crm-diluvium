import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Una celda del reporte de Meta: mensajes ENTREGADOS y su costo aproximado (en la moneda de la WABA).
export type MetaPricingCell = { volume: number; cost: number };
// Por día UTC ("YYYY-MM-DD") → tipo de precio (REGULAR = se cobra; FREE_ENTRY_POINT = 72 h por anuncio;
// FREE_CUSTOMER_SERVICE = ventana gratis; Meta puede agregar otros) → categoría (MARKETING, UTILITY,
// SERVICE, AUTHENTICATION…) → celda. Se guarda tal como lo nombra Meta.
export type MetaPricingDays = Record<string, Record<string, Record<string, MetaPricingCell>>>;

// Cobro de Meta por WhatsApp (5-oct-2026, decisión del dueño): el worker lee cada hora el
// reporte `pricing_analytics` de la cuenta de WhatsApp (WABA) con META_WHATSAPP_TOKEN y deja aquí
// la última lectura buena. El Dashboard lo muestra en la tarjeta «WhatsApp (Meta)»
// (lib/dashboard/meta-whatsapp.ts). Es aproximado según Meta; la factura está en Business Suite.
// Detalle: docs/meta-costos.md.
export const metaWhatsappBilling = pgTable("meta_whatsapp_billing", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  wabaId: text("waba_id").notNull(),
  // Moneda de la WABA (USD, MXN…), tal como la da Meta. null si aún no se leyó.
  currency: text("currency"),
  days: jsonb("days").$type<MetaPricingDays>().default({}).notNull(),
  // Última lectura completa y buena (null = nunca se ha leído bien).
  fetchedAt: timestamp("fetched_at"),
  // Último intento y su error (null si salió bien). El error nunca lleva el token.
  attemptedAt: timestamp("attempted_at").notNull(),
  lastError: text("last_error"),
});
