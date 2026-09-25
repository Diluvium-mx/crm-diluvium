// Registro MÍNIMO de comprobantes de pago leídos por el Agente IA (Fase D
// reestructurada, 24-sep-2026). El agente decide solo (Goal + lectura de la
// imagen o PDF); el CRM únicamente guarda lo que leyó para (1) el chequeo
// silencioso de referencia repetida y (2) darle al agente qué lleva pagado el
// contacto. Ninguna regla de monto vive en código. Sustituye a pagos_confirmados.
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { contacts } from "./contacts";
import { conversations, messages } from "./messaging";

// total = pago completo; anticipo = 50 % de una compuerta a la medida; resto = liquidación.
export const comprobanteTipoEnum = pgEnum("comprobante_tipo", ["total", "anticipo", "resto"]);

export const comprobantes = pgTable(
  "comprobantes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    // Mensaje del cliente con la imagen o PDF del comprobante (idempotencia por lote).
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    // Tal como lo leyó el agente; `referencia_norm` sin espacios ni guiones, en
    // mayúsculas, para buscar repetidas.
    monto: text("monto"),
    referencia: text("referencia"),
    referenciaNorm: text("referencia_norm"),
    banco: text("banco"),
    fechaComprobante: text("fecha_comprobante"),
    tipo: comprobanteTipoEnum("tipo"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("comprobantes_org_ref_idx").on(t.organizationId, t.referenciaNorm),
    index("comprobantes_contact_idx").on(t.contactId, t.createdAt),
    // Un comprobante por mensaje del cliente: un reintento del job no lo duplica.
    uniqueIndex("comprobantes_message_uidx").on(t.messageId),
  ],
);
