// Mensajes programados (A6): el vendedor elige fecha y hora (America/Mazatlan)
// y el worker lo manda con un job diferido de BullMQ. La BASE es la fuente de
// verdad: si el job se pierde (Redis reinició, deploy), el barrido del worker
// lo recupera; el job solo acelera.
//
// Estados: scheduled → sending → sent | failed; o cancelled (a mano, o porque
// el cliente escribió después de programarlo y cancel_if_inbound estaba
// activo). `programmed_at` es el momento de programarlo (o de su última
// edición): un entrante POSTERIOR a esa hora lo cancela al disparar.
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { conversations, messages, templates } from "./messaging";

export const scheduledKindEnum = pgEnum("scheduled_message_kind", ["text", "template"]);
export const scheduledStatusEnum = pgEnum("scheduled_message_status", [
  "scheduled",
  "sending",
  "sent",
  "failed",
  "cancelled",
]);

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Quien lo programó: el mensaje sale a su nombre (sent_by_user_id).
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    kind: scheduledKindEnum("kind").notNull(),
    // Texto a enviar (kind=text) o vista previa ya rellenada (kind=template).
    body: text("body").notNull(),
    templateId: text("template_id").references(() => templates.id, { onDelete: "set null" }),
    // Valores de {{1}}, {{2}}, … de la plantilla, en orden.
    templateParams: jsonb("template_params").$type<string[]>().notNull().default([]),
    sendAt: timestamp("send_at").notNull(),
    programmedAt: timestamp("programmed_at").defaultNow().notNull(),
    cancelIfInbound: boolean("cancel_if_inbound").notNull().default(true),
    status: scheduledStatusEnum("status").notNull().default("scheduled"),
    // manual | cliente_escribio
    cancelReason: text("cancel_reason"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    // Mensaje que resultó del envío (burbuja del hilo).
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    // El vendedor ya vio el aviso (fallo o cancelación automática) y lo quitó.
    dismissedAt: timestamp("dismissed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_messages_conversation_idx").on(table.organizationId, table.conversationId, table.status),
    // Barrido del worker: programados vencidos y envíos atorados.
    index("scheduled_messages_due_idx")
      .on(table.status, table.sendAt)
      .where(sql`${table.status} in ('scheduled', 'sending')`),
  ],
);
