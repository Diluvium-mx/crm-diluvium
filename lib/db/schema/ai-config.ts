import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Configuración del Agente IA por organización (Fase A: Fundación del modelo).
// Una fila por organización: qué modelo filtra la bandeja (`modelo_filtro`) y
// qué modelo es el "cerebro" (`modelo_cerebro`). Los valores son ids del
// catálogo en código (lib/ai/catalog.ts), NO strings libres; las acciones los
// validan contra el catálogo antes de escribir. Editable solo owner/admin
// (ACL: recurso `aiConfig` en lib/auth/permissions.ts). Si una organización no
// tiene fila, se asumen los defaults del catálogo (filtro=Luna, cerebro=Sonnet 5).
export const aiConfig = pgTable("ai_config", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  modeloFiltro: text("modelo_filtro").notNull(),
  modeloCerebro: text("modelo_cerebro").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
