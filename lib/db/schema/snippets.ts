// Fragmentos (snippets): respuestas reutilizables a nivel ORGANIZACIÓN, con
// variables con NOMBRE tipo {{nombre}} (CLAUDE.md §5). Son texto libre nuestro,
// para responder DENTRO de la ventana de 24 h — nada que ver con las plantillas
// aprobadas por Meta (tabla `templates`, para FUERA de la ventana). Todos los
// miembros de la organización comparten los mismos fragmentos.
import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const snippets = pgTable(
  "snippets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Nombre corto para encontrarlo (p. ej. "saludo", "envío culiacán").
    name: text("name").notNull(),
    // Cuerpo con variables {{nombre}}; el vendedor las rellena al insertarlo.
    body: text("body").notNull(),
    // Nombres de las variables detectadas en el cuerpo, en orden de aparición y
    // sin repetir. Se derivan del body en cada escritura (no se piden aparte),
    // así el listado y la UI no tienen que re-parsear el texto.
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("snippets_org_idx").on(table.organizationId),
    // Un nombre no se repite dentro de la misma organización: evita fragmentos
    // duplicados y hace inequívoco buscarlos por nombre.
    uniqueIndex("snippets_org_name_uidx").on(table.organizationId, table.name),
  ],
);
