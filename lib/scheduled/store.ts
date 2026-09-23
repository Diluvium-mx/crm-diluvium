// Mensajes programados (A6): lecturas y escrituras con la organización
// EXPLÍCITA (la resuelven las server actions desde la sesión; nunca viene del
// cliente). Validan igual que el envío inmediato: ventana de 24 h para texto
// libre y plantilla aprobada del canal de la conversación.
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, scheduledMessages, templates } from "@/lib/db/schema";
import { renderTemplateBody, templateMaxIndex } from "@/lib/messaging/template-format";
import { isTemplateSendable } from "@/lib/templates/types";
import { isRetryableScheduledError, SEND_AT_MESSAGES, textAllowedAt, validateSendAt } from "./rules";
import type { ScheduledView } from "./types";

const MAX_TEXT = 4096; // límite de WhatsApp para texto

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

type Row = typeof scheduledMessages.$inferSelect;

function toView(row: Row): ScheduledView {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    sendAt: row.sendAt,
    cancelIfInbound: row.cancelIfInbound,
    status: row.status,
    cancelReason: row.cancelReason,
    errorMessage: row.errorMessage,
    canRetry: row.status === "failed" && isRetryableScheduledError(row.errorCode),
  };
}

/**
 * Lo que se ve arriba del composer: pendientes, en envío, y los avisos que el
 * vendedor aún no descarta (fallidos y cancelados porque el cliente escribió).
 */
export async function listScheduledForConversation(organizationId: string, conversationId: string): Promise<ScheduledView[]> {
  const rows = await db
    .select()
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.organizationId, organizationId),
        eq(scheduledMessages.conversationId, conversationId),
        or(
          inArray(scheduledMessages.status, ["scheduled", "sending"]),
          and(
            isNull(scheduledMessages.dismissedAt),
            or(
              eq(scheduledMessages.status, "failed"),
              and(
                eq(scheduledMessages.status, "cancelled"),
                inArray(scheduledMessages.cancelReason, ["cliente_escribio", "autor_inactivo"]),
              ),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(scheduledMessages.sendAt));
  return rows.map(toView);
}

async function loadConversation(organizationId: string, conversationId: string) {
  const [row] = await db
    .select({ id: conversations.id, channelId: conversations.channelId, windowExpiresAt: conversations.windowExpiresAt })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ScheduleError("Conversación no encontrada.");
  return row;
}

function checkSendAt(sendAt: Date | null, now: Date): Date {
  const error = validateSendAt(sendAt, now);
  if (error || !sendAt) throw new ScheduleError(SEND_AT_MESSAGES[error ?? "invalid"]);
  return sendAt;
}

function checkText(raw: string, windowExpiresAt: Date | null, sendAt: Date): string {
  const text = raw.trim();
  if (!text) throw new ScheduleError("El mensaje está vacío.");
  if (text.length > MAX_TEXT) throw new ScheduleError(`El mensaje excede ${MAX_TEXT} caracteres.`);
  if (!textAllowedAt(windowExpiresAt, sendAt)) {
    throw new ScheduleError(
      "A esa hora la ventana de 24 h ya estará cerrada: solo se puede programar una plantilla.",
    );
  }
  return text;
}

// La plantilla debe ser de la organización y del canal de la conversación,
// estar aprobada y ser enviable desde el CRM, con todas sus variables llenas.
async function checkTemplate(organizationId: string, channelId: string, templateId: string, params: string[]) {
  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.organizationId, organizationId)))
    .limit(1);
  if (!template || template.channelId !== channelId) {
    throw new ScheduleError("La plantilla no existe en el canal de esta conversación.");
  }
  if (!isTemplateSendable(template.status)) throw new ScheduleError("La plantilla no está aprobada por Meta.");
  if (template.unsupported) {
    throw new ScheduleError("Esta plantilla usa variables en el encabezado o botón que el CRM aún no puede enviar.");
  }
  const values = params.map((value) => value.trim());
  const expected = templateMaxIndex(template.body);
  if (values.length !== expected || values.some((value) => value.length === 0)) {
    throw new ScheduleError(`La plantilla necesita ${expected} variable(s), todas con valor.`);
  }
  return { template, values, preview: template.body ? renderTemplateBody(template.body, values) : template.name };
}

export type CreateScheduledParams = {
  organizationId: string;
  userId: string;
  conversationId: string;
  sendAt: Date | null;
  cancelIfInbound: boolean;
  now?: Date;
} & ({ kind: "text"; text: string } | { kind: "template"; templateId: string; templateParams: string[] });

export async function createScheduled(params: CreateScheduledParams): Promise<Row> {
  const now = params.now ?? new Date();
  const conversation = await loadConversation(params.organizationId, params.conversationId);
  const sendAt = checkSendAt(params.sendAt, now);

  let body: string;
  let templateId: string | null = null;
  let templateParams: string[] = [];
  if (params.kind === "text") {
    body = checkText(params.text, conversation.windowExpiresAt, sendAt);
  } else {
    const checked = await checkTemplate(params.organizationId, conversation.channelId, params.templateId, params.templateParams);
    body = checked.preview;
    templateId = checked.template.id;
    templateParams = checked.values;
  }

  const [row] = await db
    .insert(scheduledMessages)
    .values({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      conversationId: conversation.id,
      createdByUserId: params.userId,
      kind: params.kind,
      body,
      templateId,
      templateParams,
      sendAt,
      programmedAt: now,
      cancelIfInbound: params.cancelIfInbound,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

async function lockScheduled(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.organizationId, organizationId)))
    .for("update")
    .limit(1);
  if (!row) throw new ScheduleError("Mensaje programado no encontrado.");
  return row;
}

/**
 * Edita hora, texto (solo kind=text) y "cancelar si el cliente escribe". Solo
 * mientras siga "scheduled". Reinicia `programmed_at`: el vendedor lo
 * reprogramó sabiendo lo que el cliente ya había escrito.
 */
export async function updateScheduled(params: {
  organizationId: string;
  id: string;
  sendAt: Date | null;
  cancelIfInbound: boolean;
  text?: string;
  now?: Date;
}): Promise<{ before: Row; after: Row }> {
  const now = params.now ?? new Date();
  return db.transaction(async (tx) => {
    const before = await lockScheduled(tx, params.organizationId, params.id);
    if (before.status !== "scheduled") throw new ScheduleError("Este mensaje ya no se puede editar.");
    const sendAt = checkSendAt(params.sendAt, now);
    const [conversation] = await tx
      .select({ windowExpiresAt: conversations.windowExpiresAt })
      .from(conversations)
      .where(eq(conversations.id, before.conversationId))
      .limit(1);
    const body =
      before.kind === "text"
        ? checkText(params.text ?? before.body, conversation?.windowExpiresAt ?? null, sendAt)
        : before.body;
    const [after] = await tx
      .update(scheduledMessages)
      .set({ sendAt, body, cancelIfInbound: params.cancelIfInbound, programmedAt: now, updatedAt: now })
      .where(eq(scheduledMessages.id, before.id))
      .returning();
    return { before, after };
  });
}

/** Cancela uno pendiente. Uno fallido o ya cancelado solo se descarta de la vista. */
export async function cancelScheduled(organizationId: string, id: string, now: Date = new Date()): Promise<Row> {
  return db.transaction(async (tx) => {
    const row = await lockScheduled(tx, organizationId, id);
    if (row.status === "sending") throw new ScheduleError("Ya se está enviando; no se puede cancelar.");
    if (row.status === "sent") throw new ScheduleError("Ya se envió.");
    const [updated] = await tx
      .update(scheduledMessages)
      .set(
        row.status === "scheduled"
          ? { status: "cancelled", cancelReason: "manual", dismissedAt: now, updatedAt: now }
          : { dismissedAt: now, updatedAt: now },
      )
      .where(eq(scheduledMessages.id, row.id))
      .returning();
    return updated;
  });
}

/**
 * ⚠ Reintentar un programado que falló: se manda YA (send_at = ahora). Vuelve a
 * validar la ventana para texto libre; `programmed_at` = ahora (solo un
 * entrante a partir de aquí lo cancelaría).
 */
export async function retryScheduled(organizationId: string, id: string, now: Date = new Date()): Promise<Row> {
  return db.transaction(async (tx) => {
    const row = await lockScheduled(tx, organizationId, id);
    if (row.status !== "failed") throw new ScheduleError("Solo se puede reintentar un mensaje que falló.");
    if (row.errorCode === "provider_rejected") {
      throw new ScheduleError("WhatsApp lo rechazó: reinténtalo desde el mensaje en el chat.");
    }
    if (!isRetryableScheduledError(row.errorCode)) {
      throw new ScheduleError("No se sabe si salió: revisa el chat y, si no llegó, prográmalo de nuevo.");
    }
    if (row.kind === "text") {
      const [conversation] = await tx
        .select({ windowExpiresAt: conversations.windowExpiresAt })
        .from(conversations)
        .where(eq(conversations.id, row.conversationId))
        .limit(1);
      if (!textAllowedAt(conversation?.windowExpiresAt ?? null, now)) {
        throw new ScheduleError("La ventana de 24 h está cerrada: programa una plantilla en su lugar.");
      }
    }
    const [updated] = await tx
      .update(scheduledMessages)
      .set({
        status: "scheduled",
        sendAt: now,
        programmedAt: now,
        errorCode: null,
        errorMessage: null,
        dismissedAt: null,
        updatedAt: now,
      })
      .where(eq(scheduledMessages.id, row.id))
      .returning();
    return updated;
  });
}

/** Filas del barrido del worker: vencidas sin enviar y envíos atorados. */
export async function dueScheduled(now: Date, graceMs: number, limit = 100) {
  return db
    .select({ id: scheduledMessages.id, sendAt: scheduledMessages.sendAt })
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.status, "scheduled"), lte(scheduledMessages.sendAt, new Date(now.getTime() - graceMs))))
    .orderBy(asc(scheduledMessages.sendAt))
    .limit(limit);
}
