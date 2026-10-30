// Links de pago del Agente IA (30-oct-2026, docs/agente-ia/2026-10-30-links-de-pago.md): los links de
// MercadoPago que el Agente IA manda cuando el cliente elige pagar con tarjeta. Cada uno cobra un monto
// fijo: el total de lo que eligió (`cubre = 'total'`) o la mitad de una compuerta a la medida
// (`cubre = 'mitad'`: anticipo o liquidación). `meses` = hasta cuántos meses sin intereses (0 = contado).
// `solo_vendedor` (30-oct-2026, migración 0077): los de precio especial (descuentos, Los Mochis) se guardan
// aquí para tenerlos a la mano en el ⚡ del chat, pero el Agente IA nunca los ve (regla del dueño).
// Los edita cualquier rol en Agente IA › Links de pago (cada guardado queda en el Historial).
import { sql } from "drizzle-orm";
import { boolean, check, index, numeric, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const linksPago = pgTable(
  "links_pago",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    monto: numeric("monto", { precision: 12, scale: 2 }).notNull(),
    cubre: text("cubre").$type<"total" | "mitad">().notNull(),
    meses: smallint("meses").default(0).notNull(),
    url: text("url").notNull(),
    soloVendedor: boolean("solo_vendedor").default(false).notNull(),
    posicion: smallint("posicion").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("links_pago_monto_check", sql`${table.monto} > 0`),
    check("links_pago_cubre_check", sql`${table.cubre} in ('total', 'mitad')`),
    check("links_pago_meses_check", sql`${table.meses} between 0 and 24`),
    index("links_pago_org_idx").on(table.organizationId, table.posicion),
  ],
);

// Los dos mensajes que salen con cada link (30-oct-2026, migración 0077): el 1.º lleva el link
// ({{monto}}, {{link}}, {{forma_de_pago}}) y el 2.º, aparte, pide los datos de envío. null = el de fábrica
// (lib/agente-ia/links-pago.ts); un 2.º vacío = no sale. Una fila por organización.
export const linksPagoTextos = pgTable("links_pago_textos", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  mensaje1: text("mensaje_1"),
  mensaje2: text("mensaje_2"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
