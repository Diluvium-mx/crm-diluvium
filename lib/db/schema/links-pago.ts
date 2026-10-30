// Links de pago del Agente IA (30-oct-2026, docs/agente-ia/2026-10-30-links-de-pago.md): los links de
// MercadoPago que el Agente IA manda cuando el cliente elige pagar con tarjeta. Cada uno cobra un monto
// fijo: el total de lo que eligió (`cubre = 'total'`) o la mitad de una compuerta a la medida
// (`cubre = 'mitad'`: anticipo o liquidación). `meses` = hasta cuántos meses sin intereses (0 = contado).
// Los de precio especial (descuentos, Los Mochis) NO van aquí: son solo del vendedor (regla del dueño).
// Los edita owner/admin en Agente IA › Links de pago; el vendedor solo los ve.
import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
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
