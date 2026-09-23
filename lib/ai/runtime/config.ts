// Configuración efectiva del Agente IA para una organización (Fase B): la fila
// de ai_config con defaults si falta, y la base de conocimiento habilitada.
// Sin "server-only": lo importa el worker (Node puro), no solo Next.
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, aiKnowledge } from "@/lib/db/schema";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL } from "@/lib/ai/catalog";
import type { Faq } from "./knowledge";

export type AgentConfig = {
  modeloFiltro: string;
  modeloCerebro: string;
  goal: string | null;
  responseDelaySeconds: number;
  maxWaitSeconds: number;
  handoverReactivateHours: number;
  antiLoopMaxPerHour: number;
  maxRepliesPerContact: number | null;
  pauseOnHumanReply: boolean;
  contextMessages: number;
  maxBubbles: number;
  dailyBudgetUsd: number;
};

// Mismos defaults que las columnas de ai_config (migraciones 0014/0015).
export const AGENT_CONFIG_DEFAULTS: AgentConfig = {
  modeloFiltro: DEFAULT_FILTER_MODEL,
  modeloCerebro: DEFAULT_BRAIN_MODEL,
  goal: null,
  responseDelaySeconds: 15,
  maxWaitSeconds: 60,
  handoverReactivateHours: 8,
  antiLoopMaxPerHour: 10,
  maxRepliesPerContact: null,
  pauseOnHumanReply: true,
  contextMessages: 20,
  maxBubbles: 2,
  dailyBudgetUsd: 20,
};

export async function loadAgentConfig(organizationId: string): Promise<AgentConfig> {
  const [row] = await db.select().from(aiConfig).where(eq(aiConfig.organizationId, organizationId)).limit(1);
  if (!row) return { ...AGENT_CONFIG_DEFAULTS };
  return {
    modeloFiltro: row.modeloFiltro,
    modeloCerebro: row.modeloCerebro,
    goal: row.goal,
    responseDelaySeconds: row.responseDelaySeconds,
    maxWaitSeconds: row.maxWaitSeconds,
    handoverReactivateHours: row.handoverReactivateHours,
    antiLoopMaxPerHour: row.antiLoopMaxPerHour,
    maxRepliesPerContact: row.maxRepliesPerContact,
    pauseOnHumanReply: row.pauseOnHumanReply,
    contextMessages: row.contextMessages,
    maxBubbles: row.maxBubbles,
    dailyBudgetUsd: row.dailyBudgetUsd,
  };
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
