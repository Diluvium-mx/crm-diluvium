// Envío REAL de un intento de seguimiento (docs/seguimientos.md §7; Parte 2 y 3, 6-oct-2026). Sale
// como mensaje del Agente IA (`source: "ai_agent"`): no pausa al Agente IA, no marca leído y no
// cuenta como respuesta de un vendedor. La fila lleva `metadata.seguimiento` para que el lector
// no rehaga la ficha por su propio mensaje y para atribuir los errores de Meta (131049/131050).
// La clave de idempotencia es el id del mensaje, que el barrido aparta ANTES de mandar.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { findInternalText } from "@/lib/ai/runtime/internal-text";
import { conversations, messages, templates } from "@/lib/db/schema";
import { plainSendReason } from "@/lib/messaging/send-reasons";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { sendTemplateMessage, sendTextMessage } from "@/lib/messaging/send";
import { templateMaxIndex } from "@/lib/messaging/template-format";
import { TIME_PHRASE_TEMPLATES } from "./cases";
import { followUpText } from "./message";
import { timePhrase } from "./time-phrase";

/** Va en messages.metadata.seguimiento. `etapa` = clave de la etapa del contacto al salir (Dashboard: avanzó de etapa). */
export type FollowUpMark = { followUpId: string; intento: number; etapa?: string | null };
export type DispatchResult = { ok: true } | { ok: false; error: string; code: string | null };

/** El envío falló: el motivo en palabras del vendedor (con el código de WhatsApp si ya quedó en la fila). */
async function failure(organizationId: string, messageId: string, error: unknown): Promise<DispatchResult> {
  const [row] = await db
    .select({ code: messages.errorCode, text: messages.errorMessage })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)))
    .limit(1);
  const raw = error instanceof Error ? error.message : String(error);
  return { ok: false, error: row?.code ? plainSendReason(row.code, row.text) : raw, code: row?.code ?? null };
}

export async function sendFollowUpText(
  provider: MessagingProvider,
  input: { organizationId: string; conversationId: string; messageId: string; borrador: string; zone: string; now: Date; mark: FollowUpMark },
): Promise<DispatchResult> {
  const text = followUpText(input.borrador, input.now, input.zone);
  // Mismo último candado que las respuestas del Agente IA (sendAgentText; seguridad B, 9-oct-2026):
  // un borrador con una nota interna («[tool call] …») nunca sale; el error queda en el intento.
  const internal = findInternalText([text]);
  if (internal) return { ok: false, error: `el borrador traía una nota interna (${internal.reason}) y no se envió`, code: null };
  try {
    await sendTextMessage(provider, {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      text,
      source: "ai_agent",
      sentByUserId: null,
      markRead: false,
      now: input.now,
      metadata: { seguimiento: input.mark },
    });
    return { ok: true };
  } catch (error) {
    return failure(input.organizationId, input.messageId, error);
  }
}

/** La plantilla aprobada de ese nombre en el canal del chat (es_MX primero), con su texto. */
async function approvedTemplate(organizationId: string, conversationId: string, name: string) {
  const rows = await db
    .select({ id: templates.id, body: templates.body, language: templates.language })
    .from(templates)
    .innerJoin(conversations, and(eq(conversations.channelId, templates.channelId), eq(conversations.organizationId, organizationId)))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(templates.organizationId, organizationId),
        eq(templates.name, name),
        eq(templates.status, "APPROVED"),
        eq(templates.unsupported, false),
      ),
    );
  return rows.find((r) => r.language === "es_MX") ?? rows[0] ?? null;
}

export async function sendFollowUpTemplate(
  provider: MessagingProvider,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    templateName: string;
    /** Último mensaje del cliente: el {{1}} "cuándo nos escribió". */
    lastClientAt: Date | null;
    zone: string;
    now: Date;
    mark: FollowUpMark;
  },
): Promise<DispatchResult> {
  try {
    const template = await approvedTemplate(input.organizationId, input.conversationId, input.templateName);
    if (!template) return { ok: false, error: `la plantilla ${input.templateName} no está aprobada en este canal`, code: null };
    const count = templateMaxIndex(template.body);
    // {{1}} solo puede ser CUÁNDO escribió el cliente: el nombre del perfil nunca se usa (6-oct-2026).
    const one = TIME_PHRASE_TEMPLATES.has(input.templateName) && input.lastClientAt ? timePhrase(input.lastClientAt, input.now, input.zone) : "";
    if (count > 1 || (count === 1 && !one)) return { ok: false, error: `la plantilla ${input.templateName} pide un dato que el seguimiento no pone (nunca el nombre)`, code: null };
    await sendTemplateMessage(provider, {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      templateId: template.id,
      variableValues: count === 1 ? [one] : [],
      source: "ai_agent",
      sentByUserId: null,
      now: input.now,
      metadata: { seguimiento: input.mark },
    });
    return { ok: true };
  } catch (error) {
    return failure(input.organizationId, input.messageId, error);
  }
}
