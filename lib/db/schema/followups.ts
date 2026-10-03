// Seguimientos del Agente IA (2-oct-2026, docs/seguimientos.md). Una fila = UN pendiente de
// un chat parado (el último mensaje es nuestro y el cliente no contesta): qué quedó
// pendiente (la ficha que llena el lector en la misma lectura del Detalle), el caso de la
// tabla (§6), en qué intento va y a qué hora le toca.
//
// Parte 1 = MODO ENSAYO (`ensayo` = true): se calcula todo y se ve en la píldora 🤖 del
// composer, pero NO se le manda nada al cliente; el barrido del worker solo anota cuándo
// "habría salido" cada intento.
//
// Estados: programado (el siguiente intento espera su hora) → esperando (ya salió el último
// intento y espera respuesta) → terminado (no contestó: frío); en cualquier punto, contestado
// (el cliente escribió después de un intento) o cancelado (cancel_reason). no_seguir = la
// ficha dijo que no vale la pena (no tiene hora). Un solo programado/esperando por chat.
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";
import { conversations } from "./messaging";

/** Un intento que salió (o, en ensayo, que "habría salido"). */
export type FollowUpAttemptLog = {
  n: number;
  at: string;
  door: "texto" | "plantilla";
  template: string | null;
  /** vendedor = un seguimiento que mandó un vendedor y cuenta como intento (3-oct-2026). */
  modo: "automatico" | "sugerido" | "vendedor";
  ensayo: boolean;
};

export const followUps = pgTable(
  "follow_ups",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // Caso de la tabla (lib/followups/cases.ts).
    caso: text("caso").notNull(),
    status: text("status").notNull().default("programado"),
    // Parte 1: nada sale al cliente.
    ensayo: boolean("ensayo").notNull().default(true),
    // Intento que sigue (o el último que salió, si ya está esperando) y cuántos tiene el caso.
    intento: smallint("intento").notNull().default(1),
    totalIntentos: smallint("total_intentos").notNull().default(0),
    // La ficha del lector.
    pendiente: text("pendiente"),
    siguientePaso: text("siguiente_paso"),
    motivo: text("motivo"),
    borrador: text("borrador"),
    // "Pidió que le escribieran": fecha (YYYY-MM-DD) y hora (HH:MM) como las dijo el cliente.
    fechaPedida: text("fecha_pedida"),
    horaPedida: text("hora_pedida"),
    // "Pidió fecha": el asunto pendiente (da la hora si solo dijo el día). Migración 0057.
    casoDeFondo: text("caso_de_fondo"),
    // Plantilla que eligió el lector para el 2.º y el 3.er intento (según cómo quedó el chat).
    plantilla2: text("plantilla_2"),
    plantilla3: text("plantilla_3"),
    // Zona horaria del cliente según su lada (IANA).
    timeZone: text("time_zone").notNull(),
    // Hora del siguiente intento y por dónde saldría (texto con la ventana abierta o plantilla).
    dueAt: timestamp("due_at"),
    door: text("door"),
    templateName: text("template_name"),
    // automatico | sugerido ("Pausar agente" puesto a mano: queda para el vendedor).
    modo: text("modo").notNull().default("automatico"),
    // Sugerido fuera del horario de los vendedores: cuándo se le presenta (su última hora antes).
    presentarAt: timestamp("presentar_at"),
    // "Que salga solo": el vendedor dejó salir el intento sugerido.
    autoAprobado: boolean("auto_aprobado").notNull().default(false),
    // sistema | vendedor ("Cambiar hora").
    dueSetBy: text("due_set_by").notNull().default("sistema"),
    intentos: jsonb("intentos").$type<FollowUpAttemptLog[]>().notNull().default([]),
    cancelReason: text("cancel_reason"),
    // Último mensaje que leyó el lector para esta ficha: uno posterior la deja vieja.
    basedOnMessageAt: timestamp("based_on_message_at").notNull(),
    closedAt: timestamp("closed_at"),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("follow_ups_one_open_per_conversation")
      .on(t.organizationId, t.conversationId)
      .where(sql`${t.status} in ('programado', 'esperando')`),
    // Barrido del worker: intentos vencidos y esperas por cerrar.
    index("follow_ups_due_idx")
      .on(t.status, t.dueAt)
      .where(sql`${t.status} in ('programado', 'esperando')`),
    index("follow_ups_conversation_idx").on(t.organizationId, t.conversationId, t.createdAt),
    check(
      "follow_ups_caso_check",
      sql`${t.caso} in ('no_seguir', 'asesor_sin_respuesta', 'pidio_fecha', 'pago_pendiente', 'objecion', 'cotizacion_sin_respuesta', 'faltan_medidas', 'precio_sin_respuesta', 'solo_informacion', 'sin_punto_claro')`,
    ),
    check("follow_ups_status_check", sql`${t.status} in ('programado', 'esperando', 'contestado', 'cancelado', 'terminado', 'no_seguir')`),
    check("follow_ups_door_check", sql`${t.door} is null or ${t.door} in ('texto', 'plantilla')`),
    check("follow_ups_modo_check", sql`${t.modo} in ('automatico', 'sugerido')`),
    check("follow_ups_due_set_by_check", sql`${t.dueSetBy} in ('sistema', 'vendedor')`),
    check("follow_ups_intento_check", sql`${t.intento} between 1 and 3 and ${t.totalIntentos} between 0 and 3`),
  ],
);
