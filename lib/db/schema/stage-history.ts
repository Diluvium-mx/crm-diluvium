// Historial de etapas (9-oct-2026, decisión del dueño): una fila por cada cambio de etapa de un
// contacto, por cualquier camino (vendedor en el Embudo o el Detalle, Agente IA, lector, /banco,
// borrar una etapa). Se consulta en Dashboard › Historial de etapas; empieza vacío el día que se
// sube (sin sembrar). Los nombres de las etapas se guardan como estaban EN ESE MOMENTO (una etapa
// puede renombrarse o borrarse después) y el nombre del vendedor lo fija el trigger
// historial_fijar_autor (migración 0053), igual que el Historial del Agente IA. Si el contacto se
// borra (ARCO) se borra su historial.
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";

export const contactStageHistory = pgTable(
  "contact_stage_history",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    fromStage: text("from_stage").notNull(),
    fromName: text("from_name").notNull(),
    toStage: text("to_stage").notNull(),
    toName: text("to_name").notNull(),
    // vendedor | agente | sistema (lib/contacts/stages.ts StageChangedBy)
    changedBy: text("changed_by").notNull(),
    // Vendedor detrás del cambio, si lo hubo (también el que escribió /banco).
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contact_stage_history_org_created_idx").on(table.organizationId, table.createdAt),
    index("contact_stage_history_contact_idx").on(table.contactId),
  ],
);
