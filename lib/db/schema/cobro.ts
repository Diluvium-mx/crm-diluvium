// Pagos confirmados (Fase D). Los datos bancarios existen SOLO como imagen en el
// workflow "Datos bancarios" (decisión del dueño, 24-sep-2026): la tabla
// datos_cobro se eliminó en la 0029 y el comprobante ya no coteja destinatario.
import { index, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { contacts } from "./contacts";
import { conversations } from "./messaging";

export const pagoTipoEnum = pgEnum("pago_tipo", ["completo", "anticipo", "liquidacion"]);

// Pagos confirmados (por el agente en la parte b, o a mano). La REFERENCIA es
// única por organización: un cliente que reenvía la misma captura para "pagar"
// otra compra no puede volver a confirmarla (escenario del dueño).
export const pagosConfirmados = pgTable(
  "pagos_confirmados",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    // Referencia/clave de rastreo normalizada (sin espacios, mayúsculas).
    referencia: text("referencia").notNull(),
    montoMxn: numeric("monto_mxn", { precision: 12, scale: 2, mode: "number" }).notNull(),
    tipo: pagoTipoEnum("tipo").notNull(),
    banco: text("banco"),
    fechaComprobante: text("fecha_comprobante"),
    // "agente" o el id del usuario que lo confirmó a mano.
    confirmadoPor: text("confirmado_por").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pagos_confirmados_org_ref_uidx").on(table.organizationId, table.referencia),
    index("pagos_confirmados_conv_idx").on(table.conversationId),
  ],
);
