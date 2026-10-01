import { index, jsonb, pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import type { BotSchedule } from "@/lib/agente-ia/opciones";
import type { ChangeDetailData } from "@/lib/historial/diff";

// Configuración del Agente IA por organización (Fase A: Fundación del modelo).
// Una fila por organización: qué modelo filtra la bandeja (`modelo_filtro`) y
// qué modelo es el "cerebro" (`modelo_cerebro`). Los valores son ids del
// catálogo en código (lib/ai/catalog.ts), NO strings libres; las acciones los
// validan contra el catálogo antes de escribir. Editable solo owner/admin
// (ACL: recurso `aiConfig` en lib/auth/permissions.ts). Si una organización no
// tiene fila, se asumen los defaults del catálogo (filtro=Luna, cerebro=Sonnet 5).
export const aiConfig = pgTable("ai_config", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  modeloFiltro: text("modelo_filtro").notNull(),
  // Modelo 2 desde la Fase E: atiende las etapas que NO están en etapas_modelo_1.
  modeloCerebro: text("modelo_cerebro").notNull(),
  // Fase E (25-sep-2026): el cerebro se elige por la etapa del contacto al
  // responder: Modelo 1 (default Luna) o Modelo 2 (`modelo_cerebro`).
  modelo1: text("modelo_1").default("gpt-5.6-luna").notNull(),
  // SIN USO desde "Columnas del Embudo" (0041, 26-sep-2026): qué modelo atiende cada
  // etapa vive en funnel_stages.model_slot (la 0041 copió lo configurado aquí). La
  // columna se conserva para que el web y el worker anteriores sigan arrancando durante
  // el despliegue; borrarla en una migración posterior.
  etapasModelo1: text("etapas_modelo_1").array().default(["inbox", "prospecto", "interesado"]).notNull(),
  // Goal (system prompt maestro) del "cerebro" (Fase B). Fuente versionada:
  // docs/agente-ia/angela-goal.md, sembrado con scripts/seed-ai-knowledge.ts.
  // Nullable: una org sin Goal cargado todavía no puede responder de verdad.
  goal: text("goal"),
  // Nombre del agente (encabezado de la pestaña, editable con lápiz) y de la empresa
  // (valor personalizado {{empresa.nombre}}). 24-sep-2026.
  agentName: text("agent_name").default("Ángela").notNull(),
  companyName: text("company_name"),
  // ── Opciones del bot (26-sep-2026, sección "Opciones" de la pestaña Agente IA;
  // reglas y defaults en lib/agente-ia/opciones.ts). Los valores de fábrica son
  // EXACTAMENTE el comportamiento anterior: nada cambia hasta que alguien mueva una opción.
  // El worker las lee en cada trabajo con caché de 60 s (lib/ai/runtime/options.ts).
  // 1. Espera para juntar mensajes seguidos del cliente (5–60 s). Fábrica 15 s.
  responseDelaySeconds: integer("response_delay_seconds").default(15).notNull(),
  // Tope interno de la espera (no editable): aunque el cliente siga escribiendo, no
  // espera más que esto desde el primer mensaje sin responder (nunca menor que la espera).
  maxWaitSeconds: integer("max_wait_seconds").default(60).notNull(),
  // 2. Pausar el bot cuando un vendedor contesta (fábrica sí) y, si se pausa, tras
  // cuántas horas vuelve solo (null = nunca: a mano con "Activar", fábrica).
  pauseOnHumanReply: boolean("pause_on_human_reply").default(true).notNull(),
  humanReplyReactivateHours: integer("human_reply_reactivate_hours"),
  // 3. Cuando el cliente pide un asesor: null = avisar al vendedor y seguir contestando
  // (fábrica); con horas = avisar y pausar el bot en ese chat ese tiempo (GHL: 8 h).
  // (Columna de la Fase B reusada: era NOT NULL DEFAULT 8 sin uso; la 0038 la deja nula.)
  handoverReactivateHours: integer("handover_reactivate_hours"),
  // 4. Horario del bot en hora de Mazatlán: null = 24/7 (fábrica). Fuera de horario no
  // contesta; al abrir atiende los chats pendientes poco a poco (sweep.ts).
  botSchedule: jsonb("bot_schedule").$type<BotSchedule>(),
  // 5. Con "No" el bot ve "[imagen]" / "[nota de voz]" sin contenido y no gasta en leerla.
  readImages: boolean("read_images").default(true).notNull(),
  transcribeAudio: boolean("transcribe_audio").default(true).notNull(),
  // 6. Longitud de la respuesta (corta | balanceada | detallada; fábrica balanceada = sin
  // línea extra) y máximo de mensajes por respuesta (1 o 2; fábrica 2).
  responseLength: text("response_length").default("balanceada").notNull(),
  maxBubbles: integer("max_bubbles").default(2).notNull(),
  // 7. Tope de respuestas del bot por conversación (desde el último "Activar" o encendido).
  // null = sin tope (fábrica). Al llegar: pausa hasta "Activar" + aviso 🤖 (tarjeta amarilla).
  maxRepliesPerContact: integer("max_replies_per_contact"),
  // Sin uso desde el 23-sep-2026 (no hay freno anti-bucle ni recorte del historial);
  // se conservan las columnas.
  antiLoopMaxPerHour: integer("anti_loop_max_per_hour").default(30).notNull(),
  contextMessages: integer("context_messages").default(20).notNull(),
  // daily_budget_usd (tope diario de $20) se BORRÓ en la 0037 (26-sep-2026, decisión
  // del dueño: nunca se aplicó desde el cierre de la Fase B).
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Quién cambió qué opción del bot y cuándo (append-only). La pestaña muestra el último
// ("Último cambio: Daniel, hoy 11:20"). `field` = llave de BotOptions; valores como texto.
export const aiConfigChanges = pgTable(
  "ai_config_changes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // S3 (0053): nombre del autor EN ESE MOMENTO (trigger de la base); el Historial ya no cambia si luego se renombra.
    authorName: text("author_name"),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_config_changes_org_created_idx").on(t.organizationId, t.createdAt)],
);

// Historial de cambios (Bloque A, 28-sep-2026; subpestaña "Historial" de la pestaña Agente
// IA). Append-only y SIEMPRE en la misma transacción que el cambio (lib/historial/log.ts):
// Modelo 1 y 2, etapas, canal encendido/apagado, workflows y pausas del agente por chat.
// Las Opciones del bot (ai_config_changes) y el Goal/FAQs (ai_knowledge_versions) ya tenían
// su registro con autor y se leen de ahí. `kind`/`action`: lib/historial/labels.ts. user_id
// null = automático ("un vendedor contestó") o usuario borrado. `subject` = nombre del objeto
// en ese momento (etapa, canal, workflow o contacto del chat); `subject_id` sin llave
// foránea: la fila sobrevive aunque se borre lo que nombra. Valores ya como texto.
export const changeHistory = pgTable(
  "change_history",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // S3 (0053): nombre del autor EN ESE MOMENTO (trigger de la base); el Historial ya no cambia si luego se renombra.
    authorName: text("author_name"),
    kind: text("kind").notNull(),
    action: text("action").notNull(),
    subject: text("subject"),
    subjectId: text("subject_id"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    // Bloque E (0043): antes/después completo para "Ver cambios" (lib/historial/diff.ts);
    // null = la fila no tiene detalle (las de antes de la 0043, pausas, vendedores…).
    detail: jsonb("detail").$type<ChangeDetailData>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("change_history_org_created_idx").on(t.organizationId, t.createdAt)],
);
