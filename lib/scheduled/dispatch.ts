// Envío de un mensaje programado, del lado del WORKER (A6).
//
// 1. Toma la fila de forma atómica (scheduled → sending) solo si su hora es la
//    del job: un job viejo (la fila se editó) o repetido no hace nada.
// 2. "Cancelar si el cliente escribe antes": lo decide AQUÍ, al disparar (no la
//    ingesta): si hay un entrante posterior a `programmed_at`, se cancela.
// 3. Manda con las MISMAS funciones del envío inmediato (outbox, idempotencia,
//    ventana de 24 h para texto), a nombre de quien lo programó.
// 4. Cualquier falla queda en la fila (visible con Reintentar); nunca se traga.
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, scheduledMessages } from "@/lib/db/schema";
import { MessagingNotConfiguredError } from "@/lib/messaging";
import { SendFailedError, type MessagingProvider } from "@/lib/messaging/provider";
import { sendTemplateMessage, sendTextMessage, SendRejectedError } from "@/lib/messaging/send";

export type DispatchOutcome = "skipped" | "cancelled" | "sent" | "failed";

/** Tras esto, un "sending" sin terminar se da por interrumpido (el worker murió a la mitad). */
export const SENDING_STUCK_MS = 10 * 60_000;

function failure(error: unknown): { code: string; message: string } {
  if (error instanceof SendRejectedError) return { code: error.code, message: error.message };
  if (error instanceof SendFailedError && error.outcome === "rejected") {
    return { code: "provider_rejected", message: "WhatsApp rechazó el mensaje programado." };
  }
  if (error instanceof MessagingNotConfiguredError) {
    return { code: "not_configured", message: "El canal de WhatsApp no está configurado." };
  }
  return {
    code: "unexpected",
    message: "Error inesperado al enviar. Revisa el chat antes de reintentar.",
  };
}

export async function dispatchScheduled(
  provider: MessagingProvider,
  scheduledId: string,
  sendAtMs: number,
  now: Date = new Date(),
): Promise<DispatchOutcome> {
  const [row] = await db
    .update(scheduledMessages)
    .set({ status: "sending", attempts: sql`${scheduledMessages.attempts} + 1`, updatedAt: now })
    .where(
      and(
        eq(scheduledMessages.id, scheduledId),
        eq(scheduledMessages.status, "scheduled"),
        eq(scheduledMessages.sendAt, new Date(sendAtMs)),
      ),
    )
    .returning();
  if (!row) return "skipped";

  if (row.cancelIfInbound) {
    const [inbound] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, row.organizationId),
          eq(messages.conversationId, row.conversationId),
          eq(messages.direction, "in"),
          sql`coalesce(${messages.sentAt}, ${messages.createdAt}) > ${row.programmedAt}`,
        ),
      )
      .limit(1);
    if (inbound) {
      await db
        .update(scheduledMessages)
        .set({ status: "cancelled", cancelReason: "cliente_escribio", updatedAt: new Date() })
        .where(eq(scheduledMessages.id, row.id));
      return "cancelled";
    }
  }

  try {
    const base = {
      organizationId: row.organizationId,
      conversationId: row.conversationId,
      sentByUserId: row.createdByUserId,
      now,
    };
    let outcome: { messageId: string };
    if (row.kind === "text") {
      outcome = await sendTextMessage(provider, { ...base, text: row.body });
    } else {
      if (!row.templateId) throw new SendRejectedError("template_not_found", "La plantilla ya no existe.");
      outcome = await sendTemplateMessage(provider, {
        ...base,
        templateId: row.templateId,
        variableValues: row.templateParams,
      });
    }
    // "pending" (resultado desconocido) también cuenta como enviado: la burbuja
    // del hilo muestra "enviando" y se reconcilia sola; nunca se reintenta.
    await db
      .update(scheduledMessages)
      .set({ status: "sent", messageId: outcome.messageId, updatedAt: new Date() })
      .where(eq(scheduledMessages.id, row.id));
    return "sent";
  } catch (error) {
    const { code, message } = failure(error);
    if (code === "unexpected") console.error(`[scheduled] ${row.id}: error inesperado al enviar`, error);
    await db
      .update(scheduledMessages)
      .set({ status: "failed", errorCode: code, errorMessage: message, updatedAt: new Date() })
      .where(eq(scheduledMessages.id, row.id));
    return "failed";
  }
}

/** Barrido: un "sending" atorado (el worker murió a la mitad) pasa a fallido y visible. */
export async function failStuckSending(now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(scheduledMessages)
    .set({
      status: "failed",
      errorCode: "interrupted",
      errorMessage: "No se confirmó el envío programado. Revisa el chat antes de reintentar.",
      updatedAt: now,
    })
    .where(
      and(
        eq(scheduledMessages.status, "sending"),
        lt(scheduledMessages.updatedAt, new Date(now.getTime() - SENDING_STUCK_MS)),
      ),
    )
    .returning({ id: scheduledMessages.id });
  return rows.length;
}
