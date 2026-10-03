// Configuración efectiva del Agente IA para una organización (Fase B): la fila
// de ai_config con defaults si falta, y la base de conocimiento habilitada.
// Sin "server-only": lo importa el worker (Node puro), no solo Next.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, aiKnowledge, contacts, member, organization, user } from "@/lib/db/schema";
import type { CustomValues } from "@/lib/agente-ia/editor";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL, DEFAULT_MODEL_1 } from "@/lib/ai/catalog";
import type { Faq } from "./knowledge";

// Lo único que el runtime lee de ai_config: los modelos (filtro, Modelo 1 y Modelo 2 =
// modelo_cerebro, Fase E; qué etapa atiende cada uno vive en funnel_stages.model_slot
// desde "Columnas del Embudo") y el Goal. Todo lo demás
// es fijo desde el 23-sep-2026 (espera de 15 s, sin topes ni pausas configurables):
// el agente se rige solo por su definición (Goal + FAQs). Las columnas viejas
// (tiempos, anti-bucle, presupuesto, etc.) se conservan en la BD sin uso.
export type AgentConfig = {
  modeloFiltro: string;
  modeloCerebro: string;
  modelo1: string;
  goal: string | null;
  agentName: string;
  companyName: string | null;
};

export const AGENT_CONFIG_DEFAULTS: AgentConfig = {
  modeloFiltro: DEFAULT_FILTER_MODEL,
  modeloCerebro: DEFAULT_BRAIN_MODEL,
  modelo1: DEFAULT_MODEL_1,
  goal: null,
  agentName: "Ángela",
  companyName: null,
};

export async function loadAgentConfig(organizationId: string): Promise<AgentConfig> {
  const [row] = await db
    .select({
      modeloFiltro: aiConfig.modeloFiltro,
      modeloCerebro: aiConfig.modeloCerebro,
      modelo1: aiConfig.modelo1,
      goal: aiConfig.goal,
      agentName: aiConfig.agentName,
      companyName: aiConfig.companyName,
    })
    .from(aiConfig)
    .where(eq(aiConfig.organizationId, organizationId))
    .limit(1);
  return row ?? { ...AGENT_CONFIG_DEFAULTS };
}

// Valores personalizados de UNA conversación ({{contacto.nombre}}, etc., ver
// lib/agente-ia/editor.ts). Vendedor = el asignado a la conversación; sin
// asignar (v1) o desactivado (banned), "un asesor". Empresa = la de la pestaña o el nombre de la org.
export async function loadCustomValues(
  organizationId: string,
  conversation: { contactId: string; assigneeUserId: string | null },
  cfg: AgentConfig,
): Promise<CustomValues> {
  const [contact] = await db
    .select({ firstName: contacts.firstName })
    .from(contacts)
    .where(and(eq(contacts.id, conversation.contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  const [seller] = conversation.assigneeUserId
    ? await db
        .select({ name: user.name })
        .from(user)
        .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, organizationId)))
        .where(and(eq(user.id, conversation.assigneeUserId), sql`coalesce(${user.banned}, false) = false`))
        .limit(1)
    : [];
  return {
    ...(await orgCustomValues(organizationId, cfg)),
    contacto: contact?.firstName?.trim() || "",
    vendedor: seller?.name?.trim() || "un asesor",
  };
}

// Los mismos valores sin conversación (contacto vacío, vendedor "un asesor"): los usa la
// renovación de la caché (cache-keepalive.ts) para armar el mismo system que un chat.
export async function orgCustomValues(organizationId: string, cfg: AgentConfig): Promise<CustomValues> {
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, organizationId)).limit(1);
  return { contacto: "", vendedor: "un asesor", empresa: cfg.companyName?.trim() || org?.name || "", agente: cfg.agentName };
}

// FAQs habilitadas de la organización, en orden (para el system del cerebro).
export async function loadEnabledFaqs(organizationId: string): Promise<Faq[]> {
  return db
    .select({
      question: aiKnowledge.question,
      answer: aiKnowledge.answer,
      position: aiKnowledge.position,
      enabled: aiKnowledge.enabled,
    })
    .from(aiKnowledge)
    .where(and(eq(aiKnowledge.organizationId, organizationId), eq(aiKnowledge.enabled, true)))
    .orderBy(asc(aiKnowledge.position));
}
