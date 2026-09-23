"use server";

// Server Actions del agente en una conversación (bandeja). Cualquier miembro
// de la organización (owner/admin/agente): reactivar el agente y enviar o
// descartar su borrador son acciones de vendedor. La UI llega en el bloque final.
import { revalidatePath } from "next/cache";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { messagingProvider } from "@/lib/messaging";
import { sendTextMessage } from "@/lib/messaging/send";
import { approveDraft, discardDraft, reactivateAgentInConversation } from "@/lib/ai/runtime/manual";

export async function reactivateAgent(input: { conversationId: string }): Promise<{ changed: boolean }> {
  const { organizationId } = await requireActiveMembership();
  const changed = await reactivateAgentInConversation(organizationId, input.conversationId, new Date());
  revalidatePath("/dashboard");
  return { changed };
}

export async function approveAgentDraft(input: { draftId: string }): Promise<{ sent: number }> {
  const { organizationId, userId } = await requireActiveMembership();
  const provider = messagingProvider();
  const result = await approveDraft({
    organizationId,
    draftId: input.draftId,
    userId,
    now: new Date(),
    sendBubble: async (p) => {
      // Autoría: sigue siendo del agente (lo redactó él); queda quién lo aprobó.
      await sendTextMessage(provider, { ...p, source: "ai_agent" });
    },
  });
  revalidatePath("/dashboard");
  return result;
}

export async function discardAgentDraft(input: { draftId: string }): Promise<void> {
  const { organizationId, userId } = await requireActiveMembership();
  await discardDraft({ organizationId, draftId: input.draftId, userId, now: new Date() });
  revalidatePath("/dashboard");
}
