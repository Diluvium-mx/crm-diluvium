"use server";

// Server Actions del agente en una conversación (Bandeja y panel del contacto).
// Cualquier miembro de la organización (owner/admin/agente): apagar el bot y
// reactivarlo son trabajo diario del vendedor (también lo apaga al contestar). La
// organización sale de la SESIÓN; toda lectura/escritura filtra por ella.
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import {
  loadContactAgents,
  loadConversationAgent,
  reactivateAgentInConversation,
} from "@/lib/ai/runtime/manual";
import { pauseAgentManually } from "@/lib/ai/runtime/pause";
import { PAUSE_OPTIONS, pauseUntil } from "@/lib/agente-ia/pause";
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
    notices: row.notices.map((n) => ({
      id: n.id,
      kind: n.kind,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      resolvedAt: n.resolvedAt?.toISOString() ?? null,
      resolution: n.resolution,
    })),
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

const pauseSchema = z.object({
  conversationId: idSchema,
  option: z.enum(PAUSE_OPTIONS),
  // <input type="datetime-local"> en hora de Mazatlán; solo con "exacta".
  atLocal: z.string().max(32).nullish(),
});

// "Apagar bot": 8/12/24 h, hasta una hora exacta (Mazatlán, futura, máx. 30 días)
// o hasta que lo reactiven. La hora se calcula AQUÍ con el reloj del servidor.
export async function pauseAgent(input: {
  conversationId: string;
  option: (typeof PAUSE_OPTIONS)[number];
  atLocal?: string | null;
}): Promise<AgentActionResult> {
  try {
    const { organizationId } = await requireActiveMembership();
    const parsed = pauseSchema.parse(input);
    const now = new Date();
    const until = pauseUntil(parsed.option, now, parsed.atLocal);
    if (!until.ok) return until;
    const done = await pauseAgentManually({ organizationId, conversationId: parsed.conversationId, until: until.until, now });
    if (!done) return { ok: false, message: "No se encontró la conversación." };
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return fail(error, "No se pudo apagar el bot.");
  }
}
