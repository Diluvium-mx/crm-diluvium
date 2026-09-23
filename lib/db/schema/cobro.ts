// "Datos de cobro" de la organización (Fase D, Configuración). Una fila por
// organización. Doble uso:
// - referencia para el equipo (lo que hoy vive en la imagen de datos bancarios);
// - en la parte (b), el agente compara el DESTINATARIO/CLABE que lee en un
//   comprobante contra estos datos antes de confirmar un pago: un depósito a
//   otra cuenta nunca se confirma.
// La imagen que se envía al cliente sigue siendo un archivo de la biblioteca
// (workflow "Datos bancarios"); aquí van los datos en texto, verificables.
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

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
