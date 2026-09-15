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
    name: text("name").notNull(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    customFields: jsonb("custom_fields").notNull().default({}),
    ghlContactId: text("ghl_contact_id"),
    source: text("source"),
    stage: contactStageEnum("stage").default("inbox").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contacts_org_idx").on(table.organizationId),
    uniqueIndex("contacts_org_phone_uidx").on(table.organizationId, table.phoneE164),
  ],
);
