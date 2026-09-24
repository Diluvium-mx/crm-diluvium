"use server";

// Server Action de SOLO LECTURA: ¿el Agente IA está trabajando en esta conversación?
// (leyendo / escribiendo / enviando / nada). La organización sale de la SESIÓN y
// el lector verifica que la conversación sea suya. Fuera de lib/ai/runtime.
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { idSchema } from "@/lib/agente-ia/settings";
import { loadAgentActivity } from "@/lib/agente-ia/activity-store";
import type { AgentActivity } from "@/lib/agente-ia/activity";

export async function getAgentActivity(conversationId: string): Promise<AgentActivity> {
  try {
    const { organizationId } = await requireActiveMembership();
    return await loadAgentActivity(organizationId, idSchema.parse(conversationId));
  } catch {
    return null; // nunca rompe el chat
  }
}
