// Diccionario del equipo para el corrector ortográfico (20-oct-2026, docs/corrector.md):
// palabras que alguien agregó con «Agregar al diccionario» y que ya no se subrayan para
// NADIE de la organización (nombres de clientes, colonias, términos propios).
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const spellingWords = pgTable(
  "spelling_words",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Como la escribió quien la agregó (p. ej. "Galaxia").
    word: text("word").notNull(),
    // En minúsculas: la misma palabra no se repite aunque cambie la mayúscula.
    wordKey: text("word_key").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("spelling_words_org_key_uidx").on(table.organizationId, table.wordKey)],
);
