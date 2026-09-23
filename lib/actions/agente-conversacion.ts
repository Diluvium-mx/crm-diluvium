"use server";

// Server Actions del agente en una conversación (Bandeja y panel del contacto).
// Cualquier miembro de la organización (owner/admin/agente): pausar y reactivar
// son acciones de vendedor. La organización sale de la SESIÓN; toda
// lectura/escritura filtra por ella.
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import {
  loadContactAgents,
  loadConversationAgent,
  pauseAgentInConversation,
  reactivateAgentInConversation,
} from "@/lib/ai/runtime/manual";
import { idSchema, toAgentMode } from "@/lib/agente-ia/settings";
import type { AgentActionResult, AgentThreadView, ContactAgentView } from "@/lib/agente-ia/types";

function fail(error: unknown, fallback: string): AgentActionResult {
  if (error instanceof ZodError) return { ok: false, message: fallback };
  console.error(`[agente] ${fallback}`, error);
  return { ok: false, message: fallback };
}

export async function getConversationAgent(conversationId: string): Promise<AgentThreadView | null> {
  const { organizationId } = await requireActiveMembership();
  const row = await loadConversationAgent(organizationId, idSchema.parse(conversationId));
  if (!row) return null;
  return {
    channelMode: toAgentMode(row.channelMode),
    agentState: row.agentState,
    pausedUntil: row.pausedUntil?.toISOString() ?? null,
    notices: row.notices.map((n) => ({ id: n.id, kind: n.kind, body: n.body, createdAt: n.createdAt.toISOString() })),
  };
}

export async function getContactAgentStatus(contactId: string): Promise<ContactAgentView[]> {
  const { organizationId } = await requireActiveMembership();
  const rows = await loadContactAgents(organizationId, idSchema.parse(contactId));
  return rows.map((r) => ({ ...r, channelMode: toAgentMode(r.channelMode), pausedUntil: r.pausedUntil?.toISOString() ?? null }));
}

export async function reactivateAgent(input: { conversationId: string }): Promise<AgentActionResult> {
  try {
    const { organizationId } = await requireActiveMembership();
    await reactivateAgentInConversation(organizationId, idSchema.parse(input.conversationId), new Date());
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return fail(error, "No se pudo reactivar el agente.");
  }
}

export async function pauseAgent(input: { conversationId: string }): Promise<AgentActionResult> {
  try {
    const { organizationId } = await requireActiveMembership();
    await pauseAgentInConversation(organizationId, idSchema.parse(input.conversationId), new Date());
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return fail(error, "No se pudo pausar el agente.");
  }
}
