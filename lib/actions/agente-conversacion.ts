"use server";

// Server Actions del agente en una conversación (Bandeja y panel del contacto).
// Cualquier miembro de la organización (owner/admin/agente): pausar, reactivar
// y enviar o descartar el borrador del agente son acciones de vendedor. La
// organización sale de la SESIÓN; toda lectura/escritura filtra por ella.
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { messagingProvider } from "@/lib/messaging";
import { sendTextMessage, SendRejectedError } from "@/lib/messaging/send";
import {
  approveDraft,
  discardDraft,
  DraftNotAvailableError,
  loadContactAgents,
  loadConversationAgent,
  pauseAgentInConversation,
  reactivateAgentInConversation,
} from "@/lib/ai/runtime/manual";
import { idSchema } from "@/lib/agente-ia/settings";
import type { AgentActionResult, AgentThreadView, ContactAgentView } from "@/lib/agente-ia/types";

function fail(error: unknown, fallback: string): AgentActionResult {
  if (error instanceof ZodError) return { ok: false, message: fallback };
  if (error instanceof DraftNotAvailableError || error instanceof SendRejectedError) {
    return { ok: false, message: error.message };
  }
  console.error(`[agente] ${fallback}`, error);
  return { ok: false, message: fallback };
}

export async function getConversationAgent(conversationId: string): Promise<AgentThreadView | null> {
  const { organizationId } = await requireActiveMembership();
  const row = await loadConversationAgent(organizationId, idSchema.parse(conversationId));
  if (!row) return null;
  return {
    channelMode: row.channelMode,
    agentState: row.agentState,
    pausedUntil: row.pausedUntil?.toISOString() ?? null,
    draft: row.draft
      ? { id: row.draft.id, bubbles: row.draft.bubbles, createdAt: row.draft.createdAt.toISOString() }
      : null,
  };
}

export async function getContactAgentStatus(contactId: string): Promise<ContactAgentView[]> {
  const { organizationId } = await requireActiveMembership();
  const rows = await loadContactAgents(organizationId, idSchema.parse(contactId));
  return rows.map((r) => ({ ...r, pausedUntil: r.pausedUntil?.toISOString() ?? null }));
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

export async function approveAgentDraft(input: { draftId: string }): Promise<AgentActionResult> {
  try {
    const { organizationId, userId } = await requireActiveMembership();
    const provider = messagingProvider();
    await approveDraft({
      organizationId,
      draftId: idSchema.parse(input.draftId),
      userId,
      now: new Date(),
      sendBubble: async (p) => {
        // Autoría: sigue siendo del agente (él lo redactó); queda quién lo aprobó.
        await sendTextMessage(provider, { ...p, source: "ai_agent" });
      },
    });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return fail(error, "No se pudo enviar el borrador.");
  }
}

export async function discardAgentDraft(input: { draftId: string }): Promise<AgentActionResult> {
  try {
    const { organizationId, userId } = await requireActiveMembership();
    await discardDraft({ organizationId, draftId: idSchema.parse(input.draftId), userId, now: new Date() });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return fail(error, "No se pudo descartar el borrador.");
  }
}
