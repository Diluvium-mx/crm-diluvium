import { isNotNull } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const contactStageEnum = pgEnum("contact_stage", [
  "inbox",
  "prospecto",
  "interesado",
  "cerca_compra",
  "compra",
]);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    customFields: jsonb("custom_fields").notNull().default({}),
    ghlContactId: text("ghl_contact_id"),
    source: text("source"),
    sourceChannel: text("source_channel"),
    stage: contactStageEnum("stage").default("inbox").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contacts_org_idx").on(table.organizationId),
    // Parcial: ghl_contact_id es nullable (contactos nativos no vienen de
    // GHL) — un índice único normal rechazaría más de un NULL solo en
    // MySQL; en Postgres los NULL ya se consideran distintos entre sí, pero
    // el .where() deja explícito que la unicidad solo aplica al
    // re-emparejado con GHL, no a todas las filas.
    uniqueIndex("contacts_org_ghl_contact_id_uidx")
      .on(table.organizationId, table.ghlContactId)
      .where(isNotNull(table.ghlContactId)),
  ],
);
