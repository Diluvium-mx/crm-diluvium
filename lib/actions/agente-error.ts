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
import { resolveAgentError } from "@/lib/ai/runtime/agent-error";
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
      // La tarjeta ya quedó atendida: el barrido del worker rescata la conversación en minutos.
      console.error("[agente-error] no se pudo programar el reintento", error);
      return { ok: false, message: "No se pudo reintentar ahora; el CRM lo intentará en unos minutos." };
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
    const done = await resolveAgentError({ organizationId, noticeId: idSchema.parse(input.noticeId), resolution: "apagar", userId });
    if (!done) return { ok: false, message: YA_ATENDIDA };
    // La misma pausa que cuando un vendedor contesta: se reactiva con "Reactivar".
    await setAgentState(organizationId, done.conversationId, "pausado_humano", { now: new Date() });
    await withQueueTimeout(cancelAgentRun(bullAgentQueuePort(), done.conversationId), "apagar").catch(() => false);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "No se pudo apagar el agente." };
    console.error("[agente-error] apagar", error);
    return { ok: false, message: "No se pudo apagar el agente." };
  }
}
