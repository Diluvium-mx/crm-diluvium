// Fase D del Agente IA: Automatización (docs/fase-d-diseno.md §3).
// - media_assets: biblioteca de imágenes/videos/documentos de la organización
//   (el archivo vive en el bucket; aquí solo la ficha).
// - workflows + workflow_steps: secuencias de pasos que se disparan por el
//   agente (tool-calling), por comando del vendedor, por palabra clave del
//   cliente o por cambio de etapa.
// - workflow_runs: cada corrida, con su rastro (mensajes enviados, error).
// Multi-tenant: toda tabla lleva organization_id (CLAUDE.md §5).
import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";
import { funnelStages } from "./funnel-stages";
import { conversations } from "./messaging";

export const mediaAssetKindEnum = pgEnum("media_asset_kind", ["image", "video", "document"]);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: mediaAssetKindEnum("kind").notNull(),
    // Nombre para encontrarlo en la biblioteca (editable).
    title: text("title").notNull(),
    // Nombre de archivo que ve el cliente en un documento; para imagen/video es informativo.
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    // sha256 (hex) del archivo tal como quedó en el bucket, para detectar duplicados.
    sha256: text("sha256"),
    // Llave en el bucket: org/{org}/library/{id}-{slug}. Nunca una URL: se firma al usar.
    storageKey: text("storage_key").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    // Miniatura (30-sep-2026): JPEG chico (240×240, recorte al centro; video: su segundo 2) en base64, hecho por el
    // navegador al subir el archivo (o la primera vez que se abre Multimedia). Llega con la lista:
    // Multimedia no descarga ningún archivo para mostrarse. null = aún no hay.
    thumbnail: text("thumbnail"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Borrado lógico: un paso que lo referencia deja de poder enviarse, pero
    // las corridas viejas conservan la ficha.
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("media_assets_org_idx").on(table.organizationId, table.deletedAt),
    uniqueIndex("media_assets_storage_key_uidx").on(table.storageKey),
  ],
);

export const workflowRunTriggerEnum = pgEnum("workflow_run_trigger", ["agent", "keyword", "command", "stage"]);
export const workflowRunStatusEnum = pgEnum("workflow_run_status", [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
  // No se ejecutó por diseño (p. ej. canal fuera de "auto" para un disparo del
  // agente o por palabra clave); queda visible en la pestaña con su motivo en error_code.
  "skipped",
]);

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Identificador estable (snake_case) que usa el agente como nombre de
    // herramienta (`wf_<slug>`) y el seed para no duplicar predeterminados.
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // "Cuándo usarlo": texto que ve el agente como descripción de la
    // herramienta. Lo edita el admin sin tocar el Goal.
    agentDescription: text("agent_description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(false),
    // Predeterminado del CRM: se edita, no se borra.
    isSystem: boolean("is_system").notNull().default(false),
    triggerAgent: boolean("trigger_agent").notNull().default(false),
    // Palabras clave del CLIENTE (minúsculas, sin acentos al comparar).
    triggerKeywords: jsonb("trigger_keywords").$type<string[]>().notNull().default([]),
    // Comando del VENDEDOR en el composer, p. ej. "/tabla" (único por organización).
    triggerCommand: text("trigger_command"),
    // Se dispara cuando el contacto ENTRA a esta etapa (clave de funnel_stages; al
    // borrar la etapa, el CRM la deja en null en la misma transacción).
    triggerStage: text("trigger_stage"),
    // «Solo al inicio» (29-sep-2026, regla estricta del dueño): por palabra clave o por el
    // Agente IA solo se dispara mientras ni el Agente IA (con texto propio) ni un vendedor le
    // han contestado al cliente, y a lo mucho UNA vez por contacto (lib/workflows/start-only.ts).
    // El comando del vendedor y la etapa que mueve un vendedor salen siempre.
    triggerStartOnly: boolean("trigger_start_only").notNull().default(false),
    // 29-sep-2026 (Tabla): con «Solo al inicio», ¿también el Agente IA queda limitado? true =
    // regla estricta de arriba («Precio 2», «Información»); false = solo la palabra clave es
    // acción inicial y el Agente IA lo usa cuando haga falta (lib/workflows/steps.ts, startScopeOf).
    triggerStartOnlyAgent: boolean("trigger_start_only_agent").notNull().default(true),
    // «Máximo de envíos por chat» (29-sep-2026; null = sin límite). Cuenta lo que YA SALIÓ en la
    // conversación: sus archivos (la misma foto dentro de otro workflow también cuenta) o, sin
    // archivos, sus corridas. Frena a la palabra clave y al Agente IA; el comando del vendedor
    // suma pero puede pasarlo (lib/workflows/max-per-chat.ts).
    maxSendsPerChat: integer("max_sends_per_chat"),
    // «El workflow es la respuesta» (29-sep-2026): por palabra clave, el Agente IA no agrega nada
    // a ese mensaje y espera al cliente (aunque no termine en pregunta). Como herramienta: el texto
    // del modelo no sale; si solo manda archivos (desde el 9-oct-2026), sale el pie del workflow y
    // luego el agente revisa el mismo mensaje (complemento, lib/ai/runtime/actions.ts answerRunsOf).
    isAnswer: boolean("is_answer").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "workflows_trigger_stage_fk",
      columns: [table.organizationId, table.triggerStage],
      foreignColumns: [funnelStages.organizationId, funnelStages.key],
    }),
    uniqueIndex("workflows_org_slug_uidx").on(table.organizationId, table.slug),
    uniqueIndex("workflows_org_command_uidx")
      .on(table.organizationId, table.triggerCommand)
      .where(sql`${table.triggerCommand} is not null`),
    index("workflows_org_position_idx").on(table.organizationId, table.position),
  ],
);

export type WorkflowStepKind = "send_text" | "send_media" | "wait";

// Carga de cada tipo de paso (validada con Zod en lib/workflows/steps.ts).
export type WorkflowStepPayload =
  | { kind: "send_text"; text: string }
  // assetId null = "falta archivo": el predeterminado se sembró sin media y el
  // admin todavía no eligió el archivo en la biblioteca. `title` describe qué
  // archivo va ahí (lo muestra el editor) y no se envía al cliente.
  | { kind: "send_media"; assetId: string | null; title: string; caption?: string }
  | { kind: "wait"; seconds: number };

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    // Redundante con payload.kind a propósito: permite filtrar por tipo en SQL
    // (p. ej. "pasos que usan este archivo") sin abrir el jsonb.
    kind: text("kind").$type<WorkflowStepKind>().notNull(),
    payload: jsonb("payload").$type<WorkflowStepPayload>().notNull(),
  },
  (table) => [index("workflow_steps_workflow_idx").on(table.workflowId, table.position)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    trigger: workflowRunTriggerEnum("trigger").notNull(),
    // Vendedor que lo disparó (comando / cambio de etapa manual); null = agente o cliente.
    triggeredByUserId: text("triggered_by_user_id").references(() => user.id, { onDelete: "set null" }),
    // Entrante del cliente que originó la corrida (agente): un reintento del job del
    // agente reutiliza la corrida en vez de mandar el archivo dos veces.
    triggerMessageId: text("trigger_message_id"),
    // Argumentos con los que se disparó (p. ej. lo que leyó el agente de un comprobante).
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: workflowRunStatusEnum("status").notNull().default("queued"),
    // Índice del siguiente paso a ejecutar: un reintento retoma aquí, nunca repite lo enviado.
    stepCursor: integer("step_cursor").notNull().default(0),
    // Ids de `messages` que generó esta corrida, en orden.
    messageIds: jsonb("message_ids").$type<string[]>().notNull().default([]),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    // Corridas por conversación (historial y exclusividad en el ejecutor).
    index("workflow_runs_conv_workflow_idx").on(table.conversationId, table.workflowId, table.status),
    index("workflow_runs_org_created_idx").on(table.organizationId, sql`${table.createdAt} desc`),
    uniqueIndex("workflow_runs_agent_msg_uidx")
      .on(table.organizationId, table.workflowId, table.triggerMessageId)
      .where(sql`${table.triggerMessageId} is not null and ${table.trigger} = 'agent'`),
    // Palabra clave: un mensaje dispara como máximo UNA corrida, aunque el barrido lo vuelva a
    // evaluar tras un reinicio (revisión completa B1, 0046).
    uniqueIndex("workflow_runs_keyword_msg_uidx")
      .on(table.organizationId, table.triggerMessageId)
      .where(sql`${table.triggerMessageId} is not null and ${table.trigger} = 'keyword'`),
  ],
);
