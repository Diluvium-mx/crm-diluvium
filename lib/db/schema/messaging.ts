// Canal de mensajería (WhatsApp vía Zernio en v1) — CLAUDE.md §5.
//
// Independiente del proveedor: `provider` + `provider_*_id` guardan los ids
// del proveedor actual (Zernio) sin atar el modelo a él, para poder migrar a
// la Cloud API directa de Meta sin reescribir tablas. El id que NO cambia
// entre proveedores es el de WhatsApp (`wamid`), y es el que hace única cada
// fila de `messages` (Meta y Zernio reintentan: sin esto, duplicados).
import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";
import type { TemplateVariable } from "@/lib/templates/types";

export type MessageAttachment = {
  type: string;
  url: string;
  mimeType?: string;
  fileName?: string;
  providerMediaId?: string;
  /** sha256 (base64) según WhatsApp; la descarga se verifica contra él. */
  sha256?: string;
  /** Llave en el almacenamiento propio (bucket), cuando ya se descargó. */
  storageKey?: string;
  sizeBytes?: number;
  downloadedAt?: string;
  downloadAttempts?: number;
  downloadError?: string;
};

/** Reacción vigente de cada lado de la conversación (WhatsApp: una por persona). */
export type MessageReactions = { contact?: string; business?: string };

export const channelTypeEnum = pgEnum("channel_type", ["whatsapp"]);
export const messagingProviderEnum = pgEnum("messaging_provider", ["zernio", "meta_cloud"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["open", "pending", "closed"]);
export const messageDirectionEnum = pgEnum("message_direction", ["in", "out"]);
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contact",
  "template",
  "interactive",
  "unknown",
]);
export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);
// Quién originó el mensaje. En coexistencia el vendedor también escribe desde
// la app de WhatsApp Business del celular: esos llegan como eco
// (`business_app`) y deben verse en el hilo igual que los enviados desde el CRM.
export const messageSourceEnum = pgEnum("message_source", [
  "contact",
  "crm",
  "business_app",
  "other_api",
  // Respuesta generada por el Agente IA (Fase B). Se distingue de `crm` (humano
  // desde el CRM) y `business_app` (humano desde el celular) para: no contar como
  // "respuesta manual" que silencia al agente, contar el freno anti-bucle, y
  // atribuir el uso/costo en ai_usage.
  "ai_agent",
]);

// Interruptor del Agente IA POR CANAL (Fase B). Apagado por defecto:
//   off      = el agente no actúa;
//   borrador = genera la respuesta y la deja en la bandeja SIN enviarla;
//   auto     = genera y envía por el proveedor.
// Solo owner/admin lo cambian (pestaña Agente IA).
export const channelAiAgentModeEnum = pgEnum("channel_ai_agent_mode", ["off", "borrador", "auto"]);

// Estado del Agente IA en una conversación (Fase B):
//   activo            = elegible para responder;
//   pausado_humano    = un vendedor respondió a mano; pausa indefinida, reactivación manual;
//   pausado_handover  = "pasar a humano"; reactivación automática a las N horas;
//   pausado_antibucle = se disparó el freno anti-bucle; reactivación manual (revisión humana).
export const conversationAgentStateEnum = pgEnum("conversation_agent_state", [
  "activo",
  "pausado_humano",
  "pausado_handover",
  "pausado_antibucle",
]);

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: channelTypeEnum("type").notNull(),
    provider: messagingProviderEnum("provider").notNull(),
    // Zernio: accountId del número conectado. Meta directa: phone_number_id.
    providerAccountId: text("provider_account_id").notNull(),
    displayName: text("display_name").notNull(),
    phoneE164: text("phone_e164"),
    isActive: boolean("is_active").default(true).notNull(),
    // Interruptor del Agente IA en este canal. Apagado por defecto (seguro).
    aiAgentMode: channelAiAgentModeEnum("ai_agent_mode").default("off").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("channels_org_idx").on(table.organizationId),
    uniqueIndex("channels_provider_account_uidx").on(table.provider, table.providerAccountId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    // Id de la conversación en el proveedor (Zernio: conversationId); lo
    // necesita el envío (POST /v1/inbox/conversations/{id}/messages).
    providerConversationId: text("provider_conversation_id"),
    // Reparto de carga, no visibilidad: todos ven todo (CLAUDE.md §5).
    assigneeUserId: text("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    status: conversationStatusEnum("status").default("open").notNull(),
    // NOT NULL: una conversación nace con su primer mensaje. Así la lista
    // ordena por la columna tal cual y usa conversations_org_last_message_idx.
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    unreadCount: integer("unread_count").default(0).notNull(),
    // Ventana de 24 h: se mueve con cada mensaje ENTRANTE del contacto.
    windowExpiresAt: timestamp("window_expires_at"),
    // Se fija una sola vez, al primer saliente humano (CLAUDE.md §5).
    firstResponseSeconds: integer("first_response_seconds"),
    // ── Agente IA (Fase B) ──────────────────────────────────────────────────
    // Estado del agente en esta conversación. Default activo: elegible si el
    // canal está en borrador/auto (el interruptor del canal es el gate maestro).
    agentState: conversationAgentStateEnum("agent_state").default("activo").notNull(),
    // Hasta cuándo dura la pausa. handover = now + handover_reactivate_hours
    // (reactivación automática); humano/antibucle = null (reactivación manual
    // con el botón "Reactivar agente" en la bandeja).
    agentPausedUntil: timestamp("agent_paused_until"),
    // Último mensaje ENTRANTE del cliente y última respuesta del AGENTE en el
    // hilo. Los usa la Fase B (silencios/anti-bucle) y la Fase C (follow-ups).
    lastInboundAt: timestamp("last_inbound_at"),
    lastAgentReplyAt: timestamp("last_agent_reply_at"),
    // Destacado: marca compartida por el equipo (todos ven todo, §5).
    isStarred: boolean("is_starred").default(false).notNull(),
    // Anuncio de clic a WhatsApp que ORIGINÓ la conversación (el primer
    // `referral` recibido). Meta lo manda una sola vez: se guarda crudo y
    // completo; la UI solo recibe una versión saneada (lib/inbox).
    adReferral: jsonb("ad_referral").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Conversación continua por canal y contacto: una sola fila por par.
    uniqueIndex("conversations_channel_contact_uidx").on(table.channelId, table.contactId),
    // Orden y cursor de la bandeja: (last_message_at, id) desc.
    index("conversations_org_last_message_idx").on(
      table.organizationId,
      sql`${table.lastMessageAt} desc`,
      sql`${table.id} desc`,
    ),
    uniqueIndex("conversations_channel_provider_conv_uidx")
      .on(table.channelId, table.providerConversationId)
      .where(sql`${table.providerConversationId} is not null`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Sin FK todavía: la tabla opportunities llega con el embudo.
    opportunityId: text("opportunity_id"),
    direction: messageDirectionEnum("direction").notNull(),
    source: messageSourceEnum("source").notNull(),
    type: messageTypeEnum("type").notNull(),
    body: text("body"),
    // TODOS los adjuntos del mensaje ({type, url, mimeType?, fileName?}); un
    // mensaje puede traer varios. media_url/media_mime_type = el primero,
    // atajo para la UI. La descarga a almacenamiento propio agrega storageKey.
    attachments: jsonb("attachments").$type<MessageAttachment[]>().notNull().default([]),
    mediaUrl: text("media_url"),
    mediaMimeType: text("media_mime_type"),
    templateName: text("template_name"),
    // wamid de WhatsApp: estable entre proveedores. Único (NULL mientras un
    // saliente está en cola y aún no tiene id; en Postgres varios NULL no chocan).
    providerMessageId: text("provider_message_id").unique(),
    // Id del mensaje en el proveedor (Zernio: message.id), para cruzar estados.
    providerInternalId: text("provider_internal_id"),
    status: messageStatusEnum("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    sentByUserId: text("sent_by_user_id").references(() => user.id, { onDelete: "set null" }),
    // `referral` del anuncio de clic a WhatsApp que traía ESTE mensaje, crudo.
    adReferral: jsonb("ad_referral").$type<Record<string, unknown>>(),
    // Contexto del proveedor tal cual (Zernio `metadata`): respuesta citada
    // (quotedMessageId), ubicación, tarjetas de contacto, pedido del catálogo,
    // botones/listas. Se guarda completo; la UI lee lo que entiende.
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    // Reacciones vigentes por lado ({ contact?: "👍", business?: "❤️" }):
    // WhatsApp permite UNA reacción por persona y mensaje.
    reactions: jsonb("reactions").$type<MessageReactions>().notNull().default({}),
    // Edición / borrado por quien lo envió (message.edited / .deleted). El
    // texto original se conserva (historial en metadata.editHistory).
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
    // Hora del mensaje según WhatsApp; created_at es cuándo lo guardamos.
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      sql`${table.createdAt} desc`,
    ),
    index("messages_org_idx").on(table.organizationId),
    // Hilo del chat y semáforo de la bandeja: por conversación en orden de envío.
    // La expresión es la MISMA que ordenan las consultas (coalesce(sent_at,
    // created_at)); indexar solo sent_at no serviría a ese orden.
    index("messages_conversation_sent_idx").on(
      table.conversationId,
      sql`coalesce(${table.sentAt}, ${table.createdAt}) desc`,
    ),
    // El id interno del proveedor solo es único dentro de su organización:
    // los estados sin wamid se cruzan por (organización, id interno).
    uniqueIndex("messages_org_provider_internal_uidx")
      .on(table.organizationId, table.providerInternalId)
      .where(sql`${table.providerInternalId} is not null`),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category"),
    body: text("body"),
    status: text("status").notNull(),
    // Variables POSICIONALES del BODY ({{1}}, {{2}}): [{ index, example? }].
    variables: jsonb("variables").$type<TemplateVariable[]>().notNull().default([]),
    // true si necesita parámetros que el CRM no arma (variables en encabezado o
    // botón): aunque esté aprobada por Meta, no es enviable desde el CRM.
    unsupported: boolean("unsupported").notNull().default(false),
    providerTemplateId: text("provider_template_id"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("templates_channel_name_lang_uidx").on(table.channelId, table.name, table.language),
  ],
);

// Bitácora cruda de TODO webhook recibido, antes de procesarlo:
// - idempotencia: el id del evento del proveedor es la PK (Zernio reintenta
//   hasta 7 veces; el mismo evento no se procesa dos veces);
// - cero pérdida: si el formato cambia o el worker falla, el payload
//   original sigue aquí para reprocesarlo.
// Sin organization_id: se guarda antes de saber a qué organización pertenece.
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: messagingProviderEnum("provider").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    // Se puebla al procesar, cuando ya se conoce el canal (y su organización).
    // Nullable: hay eventos sin organización (p. ej. la prueba del webhook) y
    // rows viejos anteriores a esta columna. FK con cascade: al borrar una
    // organización se llevan también sus payloads crudos (datos del cliente).
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    // Cuándo quedó en dead-letter (agotó intentos o formato no reconocido).
    // Queda en la BD para revisarlo y reprocesarlo; la retención no lo purga.
    deadLetteredAt: timestamp("dead_lettered_at"),
  },
  (table) => [
    index("webhook_events_pending_idx")
      .on(table.receivedAt)
      .where(sql`${table.processedAt} is null`),
    // Barrido de retención: borra procesados viejos por fecha.
    index("webhook_events_dead_letter_idx")
      .on(table.deadLetteredAt)
      .where(sql`${table.deadLetteredAt} is not null`),
    index("webhook_events_processed_idx")
      .on(table.processedAt)
      .where(sql`${table.processedAt} is not null`),
  ],
);
