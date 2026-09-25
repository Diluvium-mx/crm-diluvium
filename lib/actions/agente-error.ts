"use server";

// Botones de la tarjeta "El agente no pudo responder" (Fase E, "reenvío seguro",
// 25-sep-2026). Cualquier miembro de la organización (el vendedor de esa
// conversación) los usa. "Reintentar": un intento más, ya, sobre lo que el cliente
// dejó sin respuesta (si mientras tanto contestó un vendedor o se pausó, no hace
// nada). "Apagar": pausa al agente solo en esa conversación; "Reactivar" lo regresa.
// Un doble clic no reintenta dos veces (resolveAgentError atiende la tarjeta una vez).
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { idSchema } from "@/lib/agente-ia/settings";
import type { AgentActionResult } from "@/lib/agente-ia/types";
import { openAgentErrorConversation, reopenAgentError, resolveAgentError } from "@/lib/ai/runtime/agent-error";
import { bullAgentQueuePort, cancelAgentRun, redisKvPort, scheduleAgentRun, withQueueTimeout } from "@/lib/ai/runtime/queue";
import { setAgentState } from "@/lib/ai/runtime/state";

const YA_ATENDIDA = "Esta tarjeta ya se atendió.";

export async function retryAgentAfterError(input: { noticeId: string }): Promise<AgentActionResult> {
  try {
    const { organizationId, userId } = await requireActiveMembership();
    const done = await resolveAgentError({ organizationId, noticeId: idSchema.parse(input.noticeId), resolution: "reintentar", userId });
    if (!done) return { ok: false, message: YA_ATENDIDA };
    try {
      await withQueueTimeout(scheduleAgentRun(bullAgentQueuePort(), redisKvPort(), { conversationId: done.conversationId, organizationId }, 0), "reintentar");
    } catch (error) {
      // Sin corrida programada nadie quedaría a cargo: la tarjeta se reabre.
      console.error("[agente-error] no se pudo programar el reintento", error);
      await reopenAgentError(organizationId, idSchema.parse(input.noticeId));
      return { ok: false, message: "No se pudo reintentar ahora; inténtalo de nuevo en un momento." };
    }
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "No se pudo reintentar." };
    console.error("[agente-error] reintentar", error);
    return { ok: false, message: "No se pudo reintentar." };
  }
}

export async function pauseAgentAfterError(input: { noticeId: string }): Promise<AgentActionResult> {
  try {
    const { organizationId, userId } = await requireActiveMembership();
    const noticeId = idSchema.parse(input.noticeId);
    const conversationId = await openAgentErrorConversation(organizationId, noticeId);
    if (!conversationId) return { ok: false, message: YA_ATENDIDA };
    // PRIMERO la pausa (la misma que cuando un vendedor contesta; se reactiva con
    // "Reactivar") y DESPUÉS la tarjeta: nunca "Se apagó" con el agente todavía activo.
    await setAgentState(organizationId, conversationId, "pausado_humano", { now: new Date() });
    await withQueueTimeout(cancelAgentRun(bullAgentQueuePort(), conversationId), "apagar").catch(() => false);
    await resolveAgentError({ organizationId, noticeId, resolution: "apagar", userId });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "No se pudo apagar el agente." };
    console.error("[agente-error] apagar", error);
    return { ok: false, message: "No se pudo apagar el agente." };
  }
}
