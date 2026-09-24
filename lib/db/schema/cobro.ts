// "Datos de cobro" de la organización (Fase D, Configuración). Una fila por
// organización. Doble uso:
// - referencia para el equipo (lo que hoy vive en la imagen de datos bancarios);
// - en la parte (b), el agente compara el DESTINATARIO/CLABE que lee en un
//   comprobante contra estos datos antes de confirmar un pago: un depósito a
//   otra cuenta nunca se confirma.
// La imagen que se envía al cliente sigue siendo un archivo de la biblioteca
// (workflow "Datos bancarios"); aquí van los datos en texto, verificables.
import { index, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";
import { conversations } from "./messaging";

export const datosCobro = pgTable("datos_cobro", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  banco: text("banco").notNull().default(""),
  beneficiario: text("beneficiario").notNull().default(""),
  // CLABE (18 dígitos) tal cual; se muestra completa solo a owner/admin.
  clabe: text("clabe").notNull().default(""),
  // Número de cuenta o tarjeta para depósito en ventanilla (opcional).
  cuenta: text("cuenta").notNull().default(""),
  // Concepto/referencia que se pide al cliente (p. ej. "nombre y tamaño").
  concepto: text("concepto").notNull().default(""),
  // Precios y condiciones que el agente puede cotejar contra un comprobante
  // (anticipo 50 % a la medida, etc.). Texto libre corto para el equipo.
  notas: text("notas").notNull().default(""),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
