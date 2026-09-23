import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";

export const lineaCompuertaEnum = pgEnum("linea_compuerta", ["mini", "estandar"]);

export const contactEntradas = pgTable(
  "contact_entradas",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    posicion: smallint("posicion").notNull(),
    anchoCm: integer("ancho_cm"),
    linea: lineaCompuertaEnum("linea").default("estandar").notNull(),
    tamanoSugerido: text("tamano_sugerido"),
    tamanoManual: text("tamano_manual"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check("contact_entradas_posicion_check", sql`${table.posicion} > 0`),
    check(
      "contact_entradas_ancho_cm_check",
      sql`${table.anchoCm} is null or ${table.anchoCm} between 1 and 1000`,
    ),
    unique("contact_entradas_contact_posicion_unique").on(table.contactId, table.posicion),
    index("contact_entradas_org_contact_idx").on(table.organizationId, table.contactId),
  ],
);

export const tallasCompuerta = pgTable(
  "tallas_compuerta",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    linea: lineaCompuertaEnum("linea").notNull(),
    talla: text("talla").notNull(),
    minCm: integer("min_cm").notNull(),
    maxCm: integer("max_cm").notNull(),
    posicion: smallint("posicion").notNull(),
  },
  (table) => [
    check(
      "tallas_compuerta_rango_check",
      sql`${table.minCm} > 0 and ${table.minCm} <= ${table.maxCm}`,
    ),
    unique("tallas_compuerta_org_linea_talla_unique").on(
      table.organizationId,
      table.linea,
      table.talla,
    ),
  ],
);

export const contactComentarios = pgTable(
  "contact_comentarios",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    check(
      "contact_comentarios_body_check",
      sql`char_length(${table.body}) between 1 and 5000`,
    ),
    index("contact_comentarios_contact_created_idx").on(
      table.contactId,
      sql`${table.createdAt} desc`,
    ),
  ],
);
