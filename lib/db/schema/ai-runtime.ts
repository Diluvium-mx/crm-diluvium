// Tablas del runtime del Agente IA (Fase B). Archivo propio para no mezclarse
// con messaging/ai-config: uso y costo por llamada (PASO 4), precios editables
// por organización sin redeploy, y borradores del modo "borrador".
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { conversations, messages } from "./messaging";

// Etapa del pipeline del agente que hizo la llamada al modelo.
export const aiUsageStageEnum = pgEnum("ai_usage_stage", ["filtro", "cerebro"]);

// Uso y costo POR LLAMADA al modelo (PASO 4). Alimenta el panel de gasto (Fase E).
// cost_usd se calcula al guardar con el precio efectivo de ese momento
// (ai_model_prices o el default del código) y queda como foto: si el precio
// cambia después, el histórico no se reescribe. NULL = modelo sin precio.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    // Último entrante que leyó el modelo (el mensaje que se estaba atendiendo).
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    stage: aiUsageStageEnum("stage").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8, mode: "number" }),
    // Decisión del filtro: spam | lead_no_sigue | necesita_cerebro | pasar_a_humano.
    filterDecision: text("filter_decision"),
    // Qué pasó con la llamada: sent | draft | discarded_stale | skipped | handover | error.
    outcome: text("outcome"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Panel de gasto: por organización y fecha.
    index("ai_usage_org_created_idx").on(t.organizationId, sql`${t.createdAt} desc`),
    // Freno anti-bucle: respuestas del agente por conversación en la última hora.
    index("ai_usage_conversation_created_idx").on(t.conversationId, t.createdAt),
  ],
);

// Precio por modelo y organización, en USD por millón de tokens. Sobrescribe
// el default del código (lib/ai/pricing.ts) SIN redeploy. Caché null = regla
// del proveedor (Anthropic/OpenAI: lectura 10%, escritura 125%).
export const aiModelPrices = pgTable(
  "ai_model_prices",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    inputPerMTok: numeric("input_per_mtok", { precision: 12, scale: 6, mode: "number" }).notNull(),
    outputPerMTok: numeric("output_per_mtok", { precision: 12, scale: 6, mode: "number" }).notNull(),
    cacheReadPerMTok: numeric("cache_read_per_mtok", { precision: 12, scale: 6, mode: "number" }),
    cacheWritePerMTok: numeric("cache_write_per_mtok", { precision: 12, scale: 6, mode: "number" }),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.modelId] })],
);

// Borradores del modo "borrador": el agente genera la respuesta y la deja aquí
// SIN enviarla; la bandeja la muestra y un humano la envía o la descarta.
export const aiDraftStatusEnum = pgEnum("ai_draft_status", ["pendiente", "enviado", "descartado", "obsoleto"]);

export const aiAgentDrafts = pgTable(
  "ai_agent_drafts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Burbujas propuestas (máx ai_config.max_bubbles), en orden de envío.
    bubbles: jsonb("bubbles").$type<string[]>().notNull(),
    // Último entrante que leyó el modelo al generar el borrador.
    triggerMessageId: text("trigger_message_id").references(() => messages.id, { onDelete: "set null" }),
    status: aiDraftStatusEnum("status").default("pendiente").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Un solo borrador vigente por conversación: el nuevo deja "obsoleto" al anterior.
    uniqueIndex("ai_agent_drafts_one_pending_uidx")
      .on(t.conversationId)
      .where(sql`${t.status} = 'pendiente'`),
    index("ai_agent_drafts_org_idx").on(t.organizationId),
  ],
);
