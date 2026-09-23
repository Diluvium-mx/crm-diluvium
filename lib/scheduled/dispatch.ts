// Envío de un mensaje programado, del lado del WORKER (A6).
//
// 1. Toma la fila de forma atómica (scheduled → sending) solo si su hora es la
//    del job: un job viejo (la fila se editó) o repetido no hace nada.
// 2. "Cancelar si el cliente escribe antes": lo decide AQUÍ, al disparar (no la
//    ingesta): si hay un entrante posterior a `programmed_at`, se cancela.
// 3. Manda con las MISMAS funciones del envío inmediato (outbox, idempotencia,
//    ventana de 24 h para texto), a nombre de quien lo programó.
// 4. Cualquier falla queda en la fila (visible con Reintentar); nunca se traga.
import { and, asc, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { member, messages, scheduledMessages, user } from "@/lib/db/schema";
import { MessagingNotConfiguredError } from "@/lib/messaging";
import { SendFailedError, type MessagingProvider } from "@/lib/messaging/provider";
import { sendTemplateMessage, sendTextMessage, SendRejectedError } from "@/lib/messaging/send";
import { pauseAgentOnManualMessage } from "@/lib/ai/runtime/hooks";

export type DispatchOutcome = "skipped" | "cancelled" | "sent" | "failed";

/** Tras esto, un "sending" sin terminar se da por interrumpido (el worker murió a la mitad). */
export const SENDING_STUCK_MS = 10 * 60_000;
/** Al conciliar un atorado, su saliente debe estar a lo más a esto de la toma. */
const SENDING_MATCH_WINDOW_MS = 2 * 60_000;
/**
 * Un programado que se dispara más de esto después de su hora (el worker estuvo
 * detenido) NO se manda solo: el contexto pudo cambiar. Queda fallido y visible;
 * "Reintentar" lo manda ya (decisión del vendedor).
 */
export const MAX_LATE_MS = 2 * 60 * 60_000;

function failure(error: unknown): { code: string; message: string } {
  if (error instanceof SendRejectedError) return { code: error.code, message: error.message };
  if (error instanceof SendFailedError && error.outcome === "rejected") {
    // El mensaje ya quedó en el chat como fallido con su propio "Reintentar":
    // se reintenta desde ahí (reintentar también aquí lo duplicaría).
    return { code: "provider_rejected", message: "WhatsApp lo rechazó; reinténtalo desde el mensaje en el chat." };
  }
  if (error instanceof MessagingNotConfiguredError) {
    return { code: "not_configured", message: "El canal de WhatsApp no está configurado." };
  }
  // Pudo haber salido (p. ej. falló algo después de llamar al proveedor): no se
  // ofrece Reintentar (lib/scheduled/rules.ts: isRetryableScheduledError).
  return {
    code: "unexpected",
    message: "No se sabe si salió. Revisa el chat y, si no llegó, prográmalo de nuevo.",
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

  // Quien lo programó debe seguir activo (miembro de la org y no desactivado):
  // el mensaje sale a su nombre.
  const [author] = await db
    .select({ banned: user.banned })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, row.organizationId), eq(member.userId, row.createdByUserId)))
    .limit(1);
  if (!author || author.banned) {
    await db
      .update(scheduledMessages)
      .set({ status: "cancelled", cancelReason: "autor_inactivo", updatedAt: new Date() })
      .where(eq(scheduledMessages.id, row.id));
    return "cancelled";
  }

  if (now.getTime() - row.sendAt.getTime() > MAX_LATE_MS) {
    await db
      .update(scheduledMessages)
      .set({
        status: "failed",
        errorCode: "late",
        errorMessage: "No se envió a tiempo (el sistema estuvo detenido). Revisa el chat antes de reintentar.",
        updatedAt: new Date(),
      })
      .where(eq(scheduledMessages.id, row.id));
    return "failed";
  }

  if (row.cancelIfInbound) {
    const [inbound] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, row.organizationId),
          eq(messages.conversationId, row.conversationId),
          eq(messages.direction, "in"),
          // "Posterior a la programación": hora de WhatsApp o, si faltara, de
          // guardado. Comparación por columna (drizzle serializa el Date).
          or(
            gt(messages.sentAt, row.programmedAt),
            and(isNull(messages.sentAt), gt(messages.createdAt, row.programmedAt)),
          ),
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
      // Autoría: un programado es un envío HUMANO desde el CRM, a nombre de quien
      // lo programó (source "crm" + sent_by_user_id): cuenta como respuesta del
      // vendedor y marca como leído, igual que un envío inmediato.
      outcome = await sendTextMessage(provider, { ...base, text: row.body, source: "crm" });
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
    // Un programado es un envío humano: pausa al Agente IA en esa conversación.
    await pauseAgentOnManualMessage(row.conversationId);
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

/**
 * Barrido: un "sending" atorado (el worker murió a la mitad) se CONCILIA con el
 * hilo antes de darlo por fallido. Si ya existe el saliente de ese envío (misma
 * conversación, mismo autor y texto, a partir de la hora en que se tomó), el
 * proveedor pudo haberlo recibido: se marca "sent" y se enlaza (su burbuja
 * muestra el estado real y nunca se reintenta desde la franja). Si no existe,
 * queda fallido SIN Reintentar: no se sabe si salió; reenviarlo usaría otra
 * clave de idempotencia y podría duplicarlo.
 */
export async function failStuckSending(now: Date = new Date()): Promise<number> {
  const stuck = await db
    .select()
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.status, "sending"),
        lt(scheduledMessages.updatedAt, new Date(now.getTime() - SENDING_STUCK_MS)),
      ),
    )
    .limit(100);
  for (const row of stuck) {
    const claimedAt = row.updatedAt.getTime();
    const [sent] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, row.organizationId),
          eq(messages.conversationId, row.conversationId),
          eq(messages.direction, "out"),
          eq(messages.sentByUserId, row.createdByUserId),
          // Texto: mismo cuerpo. Plantilla: tipo plantilla con el mismo cuerpo
          // o sin cuerpo (una plantilla sin BODY guarda null en el mensaje).
          row.kind === "text"
            ? eq(messages.body, row.body)
            : and(eq(messages.type, "template"), or(eq(messages.body, row.body), isNull(messages.body))),
          // sent_at del saliente = la hora en que el worker tomó la fila (el
          // eco de WhatsApp puede traer la suya, un poco después).
          gte(messages.sentAt, new Date(claimedAt - 1_000)),
          lte(messages.sentAt, new Date(claimedAt + SENDING_MATCH_WINDOW_MS)),
          // Nunca el saliente de OTRO programado (dos iguales del mismo autor).
          sql`not exists (select 1 from ${scheduledMessages} sm where sm.message_id = ${messages.id})`,
        ),
      )
      .orderBy(asc(messages.sentAt))
      .limit(1);
    await db
      .update(scheduledMessages)
      .set(
        sent
          ? { status: "sent", messageId: sent.id, updatedAt: now }
          : {
              status: "failed",
              errorCode: "interrupted",
              errorMessage: "No se confirmó el envío programado. Revisa el chat y, si no llegó, prográmalo de nuevo.",
              updatedAt: now,
            },
      )
      .where(
        and(
          eq(scheduledMessages.organizationId, row.organizationId),
          eq(scheduledMessages.id, row.id),
          eq(scheduledMessages.status, "sending"),
        ),
      );
  }
  return stuck.length;
}
