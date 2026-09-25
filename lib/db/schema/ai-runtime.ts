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
    // Idempotencia por entrante (alreadyHandled) y el barrido de cada minuto.
    index("ai_usage_message_outcome_idx").on(t.messageId, t.outcome),
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

// PLANES de envío del agente (desde el 23-sep ya no hay modo "borrador"): una
// respuesta de varias burbujas se guarda aquí como "enviando" antes de la 1ª para
// que, si el worker se reinicia a la mitad, el barrido la concilie con el hilo.
// "pendiente" y "descartado" quedan solo como historia de la etapa de borradores.
export const aiDraftStatusEnum = pgEnum("ai_draft_status", ["pendiente", "enviando", "enviado", "descartado", "obsoleto"]);

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
    // Por qué NO se envió solo (guardia de salida del modo auto: monto o enlace
    // fuera de la base de conocimiento). Se muestra en la tarjeta del borrador.
    reviewReason: text("review_reason"),
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
    // "¿Este entrante ya tiene borrador?" (idempotencia, corte del debounce y barrido).
    index("ai_agent_drafts_trigger_idx").on(t.triggerMessageId),
  ],
);

// Avisos del agente para el vendedor, dentro del hilo (discretos, sin acción):
// la guardia vio un monto/enlace fuera de la base, el cliente pidió a un
// vendedor, el freno anti-bucle o el presupuesto frenaron una respuesta, o un
// envío no se confirmó. Nunca pausan al agente. `message_id` = el saliente del
// agente al que se refiere (un aviso por mensaje y tipo: el barrido no repite).
export const aiAgentNotices = pgTable(
  "ai_agent_notices",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
    // guardia | pasar_a_humano | anti_bucle | presupuesto | tope_contacto | envio
    // | cotejar_deposito | cliente_pide_humano | comprobante_dudoso | respuesta_cortada
    // | agente_error (Fase E: el modelo falló; tarjeta con "Reintentar" y "Apagar")
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Fase E (agente_error): cuándo y cómo lo atendió un vendedor ("reintentar" |
    // "apagar"). null = sin atender: el agente no vuelve a llamar al modelo en esa
    // conversación hasta que alguien elija.
    resolvedAt: timestamp("resolved_at"),
    resolution: text("resolution"),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("ai_agent_notices_conversation_created_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("ai_agent_notices_message_kind_uidx")
      .on(t.messageId, t.kind)
      .where(sql`${t.messageId} is not null`),
  ],
);
