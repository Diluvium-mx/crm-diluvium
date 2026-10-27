// Reseñas en Amazon y Mercado Libre (27-oct-2026, docs/opiniones.md § Amazon y Mercado
// Libre). Una fila = un cliente que dijo en el chat que compró la compuerta en una de esas
// tiendas; la anota el lector (lib/ai/runtime/lector.ts) y el vendedor le pide la reseña
// desde Seguimientos › Amazon y Mercado Libre. Una por contacto.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";
import { conversations } from "./messaging";

export const resenasTienda = pgTable(
  "resenas_tienda",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // El chat donde lo dijo: ahí sale el mensaje que pide la reseña.
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    // amazon | mercado_libre (lib/resenas-tienda/tiendas.ts)
    tienda: text("tienda").notNull(),
    // Lo que escribió el cliente cuando lo dijo (el último mensaje suyo que nombra la tienda).
    frase: text("frase"),
    // lector | manual
    origen: text("origen").notNull().default("lector"),
    // por_pedir | pedida | la_dejo | no_quiso | descartada (el lector se equivocó: no vuelve a anotarlo)
    estado: text("estado").notNull().default("por_pedir"),
    pedidaAt: timestamp("pedida_at"),
    pedidaPorUserId: text("pedida_por_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("resenas_tienda_org_contact_uidx").on(t.organizationId, t.contactId),
    index("resenas_tienda_org_created_idx").on(t.organizationId, t.createdAt),
    check("resenas_tienda_tienda_check", sql`${t.tienda} in ('amazon', 'mercado_libre')`),
    check("resenas_tienda_origen_check", sql`${t.origen} in ('lector', 'manual')`),
    check(
      "resenas_tienda_estado_check",
      sql`${t.estado} in ('por_pedir', 'pedida', 'la_dejo', 'no_quiso', 'descartada')`,
    ),
  ],
);
