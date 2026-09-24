import { isNotNull, sql } from "drizzle-orm";
import { pgTable, text, integer, boolean, timestamp, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// Base de conocimiento del Agente IA por organización (Fase B): las FAQs que
// alimentan el "cerebro". El system del cerebro = Goal (ai_config.goal) + estas
// FAQs en formato "P: … / R: …". El contenido NO se hardcodea en el runtime:
// se siembra desde la fuente versionada docs/agente-ia/angela-faqs.json con un
// seed idempotente (upsert por organization_id + ghl_id).
export const aiKnowledge = pgTable(
  "ai_knowledge",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Ancla de trazabilidad con GHL (fuente del export). Nullable para FAQs
    // creadas nativas en el CRM a futuro; el seed solo upsertea las que tienen ancla.
    ghlId: text("ghl_id"),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    // Orden en el que se arma el bloque de FAQs del system.
    position: integer("position").notNull(),
    // Permite desactivar una FAQ sin borrarla (no entra al system del cerebro).
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_knowledge_org_idx").on(table.organizationId),
    // El cerebro lee las FAQs ordenadas por posición dentro de la org.
    index("ai_knowledge_org_position_idx").on(table.organizationId, table.position),
    // Upsert idempotente del seed por (org, ghl_id). Parcial: ghl_id es
    // nullable; en Postgres los NULL ya son distintos entre sí, y el .where()
    // deja explícito que la unicidad (y el ON CONFLICT del seed) solo aplica a
    // las FAQs con ancla de GHL.
    uniqueIndex("ai_knowledge_org_ghl_id_uidx")
      .on(table.organizationId, table.ghlId)
      .where(isNotNull(table.ghlId)),
  ],
);

// Versiones del conocimiento del agente (pestaña "Agente IA", 24-sep-2026): cada vez
// que se guarda el Goal o se cambian las FAQs queda una foto completa, para poder
// regresar a una anterior. kind = "goal" (snapshot: { goal }) | "faqs" (snapshot:
// { faqs: [{ question, answer, position, enabled }] }).
export const aiKnowledgeVersions = pgTable(
  "ai_knowledge_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("ai_knowledge_versions_org_kind_idx").on(table.organizationId, table.kind, sql`${table.createdAt} desc`)],
);
