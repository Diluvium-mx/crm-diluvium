// Rescate de un archivo que WhatsApp aceptó y luego rechazó porque no pudo bajarlo (envío
// blindado, 22-oct-2026; docs/fase-d-diseno.md §12). Antes de mandar, el enlace se prueba
// (lib/messaging/media-source.ts), pero WhatsApp lo descarga desde SUS servidores: si aun así
// avisa 131053 en los primeros minutos, el mismo archivo sale UNA vez más desde el otro origen
// (copia en Zernio ↔ bucket), sin tarjeta. Si el rescate tampoco sale, queda la tarjeta de
// siempre (delivery-notice.ts). Pasados RESCUE_WINDOW_MS ya no se reenvía: llegaría fuera de
// la plática (decisión del dueño, 22-oct-2026).
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, workflowRuns } from "@/lib/db/schema";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { sendMediaMessage, type OutboundTextSource } from "@/lib/messaging/send";
import { MEDIA_ORIGIN_META, type MediaOrigin } from "@/lib/messaging/media-source";
import type { ObjectStorage } from "@/lib/storage/s3";
import { logError } from "@/lib/log/safe-error";
import { ANSWERS_ONLY_KEY, ANSWERS_ONLY_REVIEW_KEY, ANSWERS_REVIEW_SINCE_KEY, ANSWERS_UNTIL_KEY } from "@/lib/ai/runtime/context";
import type { FailedOutbound } from "./delivery-notice";

export const RESCUE_WINDOW_MS = 10 * 60_000;
// En metadata: el original guarda a quién se pasó; el rescate, de quién viene (nunca se rescata dos veces).
export const RESCUE_META = "rescate";
export const RESCUED_FROM_META = "rescateDe";

const MEDIA_TYPES = new Set(["image", "video", "document"]);
// Lo que contestaba el original («el workflow es la respuesta», saved-reply.ts) pasa al rescate.
const ANSWER_KEYS = [ANSWERS_UNTIL_KEY, ANSWERS_ONLY_KEY, ANSWERS_ONLY_REVIEW_KEY, ANSWERS_REVIEW_SINCE_KEY];

/** ¿WhatsApp no pudo bajar el archivo? 131053 de Meta, o el 400 «Upload attachment failure» de Zernio. (pura) */
export function isMediaFetchFailure(errorCode: string | null, errorMessage: string | null): boolean {
  if ((errorCode ?? "").includes("131053")) return true;
  return /upload attachment failure|media upload error/i.test(errorMessage ?? "");
}

/** Id del archivo de la Biblioteca desde la ruta interna de la burbuja (/api/biblioteca/{id}). (pura) */
export function libraryAssetId(attachmentUrl: string | undefined): string | null {
  const match = /^\/api\/biblioteca\/([^/?#]+)$/.exec(attachmentUrl ?? "");
  return match ? match[1] : null;
}

/** Id determinista del rescate: si el mismo aviso se procesa dos veces, no sale otro. */
export function rescueMessageId(messageId: string): string {
  return `${messageId}:rescate`;
}

/**
 * true = el rescate salió (o ya había salido): no va tarjeta por el original. false = no aplica
 * o no se pudo: el que llama deja la tarjeta. Nunca lanza.
 */
export async function rescueFailedMedia(
  deps: { provider: MessagingProvider; storage: ObjectStorage; now?: Date; fetchImpl?: typeof fetch },
  failed: FailedOutbound,
): Promise<boolean> {
  const now = deps.now ?? new Date();
  try {
    if (!MEDIA_TYPES.has(failed.type) || !isMediaFetchFailure(failed.errorCode, failed.errorMessage)) return false;
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, failed.messageId), eq(messages.organizationId, failed.organizationId)))
      .limit(1);
    if (!message || message.direction !== "out") return false;
    const meta = message.metadata ?? {};
    if (meta[RESCUED_FROM_META] || meta[RESCUE_META]) return false; // solo una vez
    const assetId = libraryAssetId(message.attachments[0]?.url);
    if (!assetId) return false;
    const sentAt = message.sentAt ?? message.createdAt;
    if (now.getTime() - sentAt.getTime() > RESCUE_WINDOW_MS) return false;
    // Solo archivos de un workflow: el rescate entra a su corrida (la tarjeta, si también falla,
    // y el runtime del agente la encuentran por `message_ids`).
    const [run] = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organizationId, failed.organizationId),
          eq(workflowRuns.conversationId, failed.conversationId),
          sql`${workflowRuns.messageIds} @> ${JSON.stringify([failed.messageId])}::jsonb`,
        ),
      )
      .limit(1);
    if (!run) return false;

    const rescueId = rescueMessageId(message.id);
    const failedOrigin: MediaOrigin = meta[MEDIA_ORIGIN_META] === "zernio" ? "zernio" : "bucket";
    const prefer: MediaOrigin = failedOrigin === "bucket" ? "zernio" : "bucket";
    // Marcas ANTES de mandar: el original apunta al rescate y la corrida lo incluye.
    await db
      .update(messages)
      .set({ metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify({ [RESCUE_META]: { messageId: rescueId, at: now.toISOString() } })}::jsonb` })
      .where(eq(messages.id, message.id));
    await db
      .update(workflowRuns)
      .set({ messageIds: sql`case when ${workflowRuns.messageIds} @> ${JSON.stringify([rescueId])}::jsonb then ${workflowRuns.messageIds} else ${workflowRuns.messageIds} || ${JSON.stringify([rescueId])}::jsonb end` })
      .where(eq(workflowRuns.id, run.id));

    const carried = Object.fromEntries(ANSWER_KEYS.filter((k) => k in meta).map((k) => [k, meta[k]]));
    const source: OutboundTextSource = message.source === "crm" ? "crm" : "ai_agent";
    const outcome = await sendMediaMessage(deps.provider, deps.storage, {
      organizationId: message.organizationId,
      conversationId: message.conversationId,
      assetId,
      caption: message.body,
      source,
      sentByUserId: message.sentByUserId,
      markRead: false,
      humanAgent: source === "crm",
      messageId: rescueId,
      now,
      prefer,
      metadata: { ...carried, [RESCUED_FROM_META]: message.id },
      fetchImpl: deps.fetchImpl,
    });
    console.warn(`[workflows] ${message.id}: WhatsApp no pudo bajar el archivo (${failed.errorCode}); rescate ${rescueId} ${outcome.status}`);
    return true;
  } catch (error) {
    logError(`[workflows] no se pudo rescatar el archivo ${failed.messageId}`, error);
    return false;
  }
}
