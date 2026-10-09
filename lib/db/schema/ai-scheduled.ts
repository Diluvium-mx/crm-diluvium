import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// Una FAQ dentro de un cambio programado (misma forma que la lista del editor).
export type ScheduledFaq = { id: string; question: string; answer: string; enabled: boolean; position: number };

// Cambios del Goal y las FAQs programados para las 22:00 (9-oct-2026, regla del dueño): cada
// guardado del Goal o de una FAQ hace que Anthropic vuelva a cobrar el Goal completo, así que
// los cambios se juntan aquí y el worker los aplica de una sola vez a las 22:00 (Mazatlán).
// Una fila por organización. `goal`/`faqs` = lo programado (null = esa parte no cambia);
// `baseGoal`/`baseFaqs` = cómo estaba en vivo al programar: si a las 22:00 ya es distinto
// (alguien guardó «Ahora» después), no se pisa: queda `status = "conflicto"` para decidir.
// Detalle: docs/agente-ia.md › Programar el Goal y las FAQs para las 22:00.
export const aiScheduledChanges = pgTable("ai_scheduled_changes", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  goal: text("goal"),
  baseGoal: text("base_goal"),
  faqs: jsonb("faqs").$type<ScheduledFaq[]>(),
  baseFaqs: jsonb("base_faqs").$type<ScheduledFaq[]>(),
  // Cuándo se aplica (las 22:00 de Mazatlán del día en que se programó; de noche, de inmediato).
  applyAt: timestamp("apply_at").notNull(),
  // programado | conflicto
  status: text("status").notNull().default("programado"),
  // Por qué no se aplicó (status = conflicto).
  conflict: text("conflict"),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
