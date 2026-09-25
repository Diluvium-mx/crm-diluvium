// Lector del estado en vivo del Agente IA (solo lectura, fuera de lib/ai/runtime):
// verifica que la conversación sea de la organización, mira el job de la cola
// (tope 1.5 s: si Redis falla o tarda, se asume que no hay job) y las corridas
// de workflow abiertas. Nunca lanza por Redis: el chat no se bloquea ni se rompe.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, conversations, workflowRuns } from "@/lib/db/schema";
import { agentQueue, withQueueTimeout } from "@/lib/ai/runtime/queue";
import { resolveAgentActivity, type ActiveRun, type AgentActivity, type AgentJobInfo } from "./activity";

export type JobReader = (conversationId: string) => Promise<AgentJobInfo>;

// Reusa la cola compartida del proceso (agentQueue): sin conexiones nuevas por llamada.
export const readQueueJob: JobReader = async (conversationId) => {
  const job = await withQueueTimeout(agentQueue().getJob(conversationId), "leer el job");
  if (!job) return null;
  const state = await withQueueTimeout(job.getState(), "leer el estado del job");
  return { state, attemptsMade: job.attemptsMade ?? 0 };
};

export async function loadAgentActivity(
  organizationId: string,
  conversationId: string,
  readJob: JobReader = readQueueJob,
): Promise<AgentActivity> {
  const [row] = await db
    .select({ agentState: conversations.agentState, channelMode: channels.aiAgentMode })
    .from(conversations)
    .innerJoin(channels, and(eq(channels.id, conversations.channelId), eq(channels.organizationId, organizationId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  // Conversación de otra organización (o inexistente): nada, sin tocar la cola.
  if (!row) return null;
  if (row.agentState !== "activo" || row.channelMode !== "auto") return null;

  let job: AgentJobInfo = null;
  try {
    job = await readJob(conversationId);
  } catch {
    job = null; // Redis caído o lento: como si no hubiera job
  }
  const runs: ActiveRun[] = await db
    .select({ trigger: workflowRuns.trigger, status: workflowRuns.status, triggeredByUserId: workflowRuns.triggeredByUserId })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, organizationId),
        eq(workflowRuns.conversationId, conversationId),
        inArray(workflowRuns.status, ["queued", "running"]),
      ),
    );
  return resolveAgentActivity({ job, runs, agentState: row.agentState, channelMode: row.channelMode });
}
