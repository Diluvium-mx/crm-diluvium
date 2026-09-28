// Tarjeta en el chat cuando WhatsApp ACEPTÓ un mensaje de un workflow y minutos
// después avisó que falló (Bloque B, 28-sep-2026; pasó con la imagen de Datos
// bancarios, código 131053). La corrida ya terminó y la etapa NO se regresa: el
// vendedor ve qué no le llegó al cliente, por qué, y con qué comando reenviarlo.
// Idempotente por mensaje (ai_agent_notices: un aviso "envio" por mensaje) y
// nunca lanza: un aviso que no se pudo guardar no debe frenar la ingesta.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowRuns, workflows } from "@/lib/db/schema";
import { addNotice } from "@/lib/ai/runtime/notices";
import { plainSendReason } from "@/lib/messaging/send-reasons";

export type FailedOutbound = {
  organizationId: string;
  conversationId: string;
  messageId: string;
  type: string;
  errorCode: string | null;
  errorMessage: string | null;
};

// Qué no llegó, con su artículo (para «Vuelve a mandarla/mandarlo»).
const WHAT: Record<string, { noun: string; feminine: boolean }> = {
  image: { noun: "la imagen", feminine: true },
  video: { noun: "el video", feminine: false },
  audio: { noun: "el audio", feminine: false },
  document: { noun: "el archivo", feminine: false },
};

/** Texto de la tarjeta (puro, para probarlo solo). */
export function workflowFailureNotice(input: { type: string; workflowName: string; command: string | null; errorCode: string | null; errorMessage: string | null }): string {
  const what = WHAT[input.type] ?? { noun: "el mensaje", feminine: false };
  const again = input.command
    ? `Vuelve a ${what.feminine ? "mandarla" : "mandarlo"} con ${input.command}.`
    : `Vuelve a ${what.feminine ? "mandarla" : "mandarlo"} desde el chat.`;
  return `No le llegó al cliente ${what.noun} de ${input.workflowName}: ${plainSendReason(input.errorCode, input.errorMessage)}. ${again}`;
}

export async function noticeWorkflowSendFailed(failed: FailedOutbound): Promise<void> {
  try {
    const [run] = await db
      .select({ name: workflows.name, command: workflows.triggerCommand })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(
        and(
          eq(workflowRuns.organizationId, failed.organizationId),
          eq(workflowRuns.conversationId, failed.conversationId),
          sql`${workflowRuns.messageIds} @> ${JSON.stringify([failed.messageId])}::jsonb`,
        ),
      )
      .limit(1);
    if (!run) return;
    await addNotice({
      organizationId: failed.organizationId,
      conversationId: failed.conversationId,
      messageId: failed.messageId,
      kind: "envio",
      body: workflowFailureNotice({ ...failed, workflowName: run.name, command: run.command }),
    });
  } catch (error) {
    console.error(`[workflows] no se pudo dejar la tarjeta del envío fallido ${failed.messageId}`, error);
  }
}
