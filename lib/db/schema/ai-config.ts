import { pgTable, text, timestamp, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { organization } from "./auth";

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
  // responder. Modelo 1 (default Luna) atiende las etapas de `etapas_modelo_1`
  // (default Inbox, Prospecto e Interesado, decisión del dueño); las demás, el
  // Modelo 2 (`modelo_cerebro`). Ids del catálogo / de STAGES, validados al escribir.
  modelo1: text("modelo_1").default("gpt-5.6-luna").notNull(),
  etapasModelo1: text("etapas_modelo_1").array().default(["inbox", "prospecto", "interesado"]).notNull(),
  // Goal (system prompt maestro) del "cerebro" (Fase B). Fuente versionada:
  // docs/agente-ia/angela-goal.md, sembrado con scripts/seed-ai-knowledge.ts.
  // Nullable: una org sin Goal cargado todavía no puede responder de verdad.
  goal: text("goal"),
  // Nombre del agente (encabezado de la pestaña, editable con lápiz) y de la empresa
  // (valor personalizado {{empresa.nombre}}). 24-sep-2026.
  agentName: text("agent_name").default("Ángela").notNull(),
  companyName: text("company_name"),
  // ── Tiempo de respuesta y seguridad (Fase B); editable por org desde la UI ──
  // Debounce deslizante: espera tras el último entrante antes de responder.
  responseDelaySeconds: integer("response_delay_seconds").default(15).notNull(),
  // Tope de la espera: aunque el cliente siga escribiendo, no espera más que esto.
  maxWaitSeconds: integer("max_wait_seconds").default(60).notNull(),
  // Sin uso desde el 23-sep (pasar a humano ya no pausa); se conserva la columna.
  handoverReactivateHours: integer("handover_reactivate_hours").default(8).notNull(),
  // Freno anti-bucle: máx respuestas del agente por conversación por hora.
  antiLoopMaxPerHour: integer("anti_loop_max_per_hour").default(30).notNull(),
  // Tope total de respuestas por contacto. null = sin tope (NO copiamos el 50 de GHL).
  maxRepliesPerContact: integer("max_replies_per_contact"),
  // Si un vendedor responde a mano (CRM o celular), el agente se pausa en esa
  // conversación hasta que alguien lo reactive (comportamiento de GHL).
  pauseOnHumanReply: boolean("pause_on_human_reply").default(true).notNull(),
  // Mensajes del hilo que el cerebro recibe como contexto.
  contextMessages: integer("context_messages").default(20).notNull(),
  // Máx. burbujas por respuesta (separadas por doble salto de línea).
  maxBubbles: integer("max_bubbles").default(2).notNull(),
  // Presupuesto de modelos por organización en las últimas 24 h (USD, suma de
  // ai_usage.cost_usd). Al llegar, el agente deja de llamar modelos en TODA la org
  // hasta que la ventana de 24 h baje: tope contra gasto repartido en muchos números.
  dailyBudgetUsd: numeric("daily_budget_usd", { precision: 10, scale: 2, mode: "number" }).default(20).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
