import { isNotNull, sql } from "drizzle-orm";
import { check, index, pgTable, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";

// Columnas del Embudo (etapas) POR ORGANIZACIÓN (26-sep-2026, "Columnas del Embudo").
// Antes eran el enum fijo `contact_stage` (inbox, prospecto, interesado, cerca_compra,
// compra); ahora son filas editables: renombrar, agregar, borrar (con reasignación),
// reordenar. `contacts.stage` y `workflows.trigger_stage` guardan la CLAVE (`key`) con
// llave foránea compuesta hacia aquí: ningún contacto puede quedar apuntando a una
// etapa que no existe (borrar una etapa exige mover antes a sus contactos).
//
// - `key`: clave estable (a-z, 0-9, _), nunca cambia aunque se renombre. Es lo que el
//   Agente IA usa en `mover_etapa` y lo que viaja en los eventos del SSE.
// - `position`: orden en el tablero (1 = primera). "Solo hacia adelante" del bot se
//   decide por este orden.
// - `role`: papel fijo que usa el CRM, cada uno en EXACTAMENTE una etapa por
//   organización: `entrada` (donde llegan los contactos nuevos), `cerca_compra` (a donde
//   mueven los datos bancarios y /banco) y `venta_cerrada` (comprobante que cuadra;
//   "Compraron" en Anuncios). Una etapa con papel se renombra pero no se borra hasta
//   pasar su papel a otra.
// - `bot_rule`: cuándo debe mover el agente al contacto aquí (texto libre). El CRM arma
//   con esto la lista de etapas que recibe el agente en cada respuesta.
// - `model_slot`: qué modelo del agente atiende a los contactos en esta etapa (1 =
//   Modelo 1, 2 = Modelo 2). Sustituye a `ai_config.etapas_modelo_1`.
//
// Toda organización nace con las 5 etapas de siempre (trigger `funnel_stages_seed_org`
// de la migración 0041); el CRM exige entre 3 y 10 etapas (lib/contacts/stages.ts).
export const STAGE_ROLE_VALUES = ["entrada", "cerca_compra", "venta_cerrada"] as const;

export const funnelStages = pgTable(
  "funnel_stages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    position: smallint("position").notNull(),
    // Color de la columna (hex, "#RRGGBB").
    color: text("color").notNull(),
    role: text("role", { enum: STAGE_ROLE_VALUES }),
    botRule: text("bot_rule").notNull().default(""),
    modelSlot: smallint("model_slot").notNull().default(2),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // La llave foránea de contacts/workflows apunta a (organization_id, key).
    uniqueIndex("funnel_stages_org_key_uidx").on(table.organizationId, table.key),
    // Cada papel vive en UNA sola etapa por organización.
    uniqueIndex("funnel_stages_org_role_uidx").on(table.organizationId, table.role).where(isNotNull(table.role)),
    index("funnel_stages_org_position_idx").on(table.organizationId, table.position),
    check("funnel_stages_key_check", sql`${table.key} ~ '^[a-z0-9_]{1,40}$'`),
    check("funnel_stages_name_check", sql`length(btrim(${table.name})) between 1 and 40`),
    check("funnel_stages_position_check", sql`${table.position} >= 1`),
    check("funnel_stages_color_check", sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check("funnel_stages_model_slot_check", sql`${table.modelSlot} in (1, 2)`),
    check("funnel_stages_bot_rule_check", sql`length(${table.botRule}) <= 1000`),
  ],
);
