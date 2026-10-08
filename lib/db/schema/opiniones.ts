// Opiniones después de la compra (7-oct-2026, docs/opiniones.md). Una fila = un
// enlace al formulario público /opinion/<token> y, cuando el cliente contesta, su
// respuesta. `prueba` = enlace creado a mano en Seguimientos › Opinión (sin
// contacto) para ver el formulario como lo ve el cliente.
import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";
import { conversations } from "./messaging";

export const opiniones = pgTable(
  "opiniones",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    // Va en el enlace que se le manda por WhatsApp (que queda en el historial del chat
    // de todos modos): se guarda tal cual para poder volver a copiarlo. 128 bits al azar.
    token: text("token").notNull(),
    // Código de recomendación del cliente (p. ej. DILU-4K7P): lo comparte con un vecino.
    codigo: text("codigo").notNull(),
    prueba: boolean("prueba").notNull().default(false),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    answeredAt: timestamp("answered_at"),
    estrellas: smallint("estrellas"),
    texto: text("texto"),
    // resistio | se_metio | todavia_no (lib/opiniones/respuestas.ts)
    lluvia: text("lluvia"),
    // con_nombre | sin_nombre | no
    permiso: text("permiso"),
    nombre: text("nombre"),
    ciudad: text("ciudad"),
    // Texto exacto del permiso que aceptó, como respaldo (ley de datos personales).
    permisoTexto: text("permiso_texto"),
  },
  (t) => [
    uniqueIndex("opiniones_token_uidx").on(t.token),
    uniqueIndex("opiniones_org_codigo_uidx").on(t.organizationId, t.codigo),
    index("opiniones_org_created_idx").on(t.organizationId, t.createdAt),
    index("opiniones_contact_idx").on(t.contactId),
    check("opiniones_estrellas_check", sql`${t.estrellas} is null or ${t.estrellas} between 1 and 5`),
    check(
      "opiniones_lluvia_check",
      sql`${t.lluvia} is null or ${t.lluvia} in ('resistio', 'se_metio', 'todavia_no')`,
    ),
    check(
      "opiniones_permiso_check",
      sql`${t.permiso} is null or ${t.permiso} in ('con_nombre', 'sin_nombre', 'no')`,
    ),
  ],
);

// Ajustes de las opiniones por organización. Hoy solo el enlace de reseñas de Google
// (botón de la pantalla final); lo demás del Momento 1 (días, hora) llega con el envío.
export const opinionesConfig = pgTable("opiniones_config", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  googleResenaUrl: text("google_resena_url"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
});
