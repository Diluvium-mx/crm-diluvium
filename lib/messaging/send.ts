// Envío de texto desde el CRM (lo llama la server action del composer) con
// patrón outbox, para que un envío ambiguo NUNCA duplique el mensaje al cliente:
//
// 1. Valida conversación/organización y la ventana de 24 h: fuera de ella
//    solo se permiten plantillas (CLAUDE.md §5).
// 2. Guarda la fila "queued" ANTES de llamar al proveedor. Su id es la clave
//    de idempotencia del envío (Idempotency-Key): si la respuesta se pierde,
//    reintentar con la misma clave no manda un segundo mensaje.
// 3. Llama al proveedor y distingue:
//    - enviado → se enlaza el wamid (ver linkSentMessage);
//    - rechazado (el proveedor dijo que NO salió) → "failed" con su código;
//      se puede reintentar (retryTextMessage) sin riesgo;
//    - desconocido (timeout, corte, 5xx) → se queda "queued" con
//      error_code "send_unknown": NO se ofrece reintentar. Si el eco llega
//      con su id, se enlaza solo (ingest.ts); si no, el barrido del worker
//      (expireUnconfirmedSends) lo pasa a "failed" / send_unconfirmed.
//    Los errores nunca se tragan: quedan en error_code/error_message (§7).
// 4. El eco (message.sent) puede llegar ANTES que la respuesta de la API: si
//    ya existe una fila con ese wamid, esa fila se queda con la autoría
//    (el source de la fila en cola —"crm" o "ai_agent"— y sent_by_user_id) y
//    la de la cola se borra.
// 5. `source`/`sentByUserId` son opcionales: default "crm" + el vendedor. El
//    Agente IA manda "ai_agent" sin usuario; esos envíos NO marcan como leídos
//    los entrantes (el vendedor sigue viéndolos) y no cuentan como primera
//    respuesta humana (reconcileFirstResponse ya los excluye).
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withTxRetry } from "@/lib/db/retry";
import { channels, conversations, messages, templates } from "@/lib/db/schema";
import { applyOutboundToConversation, latestInboundMessageId } from "./ingest";
import { SendFailedError, type MessagingProvider, type SendResult } from "./provider";
import { findInternalText } from "@/lib/ai/runtime/internal-text";
import {
  canSendFreeForm,
  INSTAGRAM_PARTS_META,
  isAmbiguousSendError,
  needsHumanAgentTag,
  nextStatus,
  SEND_ACCEPTED,
  SEND_RATE_LIMITED,
  SEND_UNCONFIRMED,
  SEND_UNKNOWN,
  SEND_WARNING_META,
} from "./rules";
import { sendInTurn, type TurnMark } from "./send-turn";
import { plainSendReason } from "./send-reasons";
import { findEarlyEcho } from "./late-echo";
import { trustedMediaMime } from "./media-type";
import { addNotice } from "@/lib/ai/runtime/notices";
import { renderTemplateBody, templateMaxIndex } from "./template-format";
import { isForeignTemplateAccount } from "./template-sync";
import { loadMediaAsset, mediaAssetSignedUrl } from "@/lib/media-library/service";
import type { ObjectStorage } from "@/lib/storage/s3";
import { isTemplateSendable } from "@/lib/templates/types";
import { chatUploadMessageId } from "@/lib/chat-attachments/keys";

export class SendRejectedError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "window_closed"
      | "not_linked"
      | "empty"
      | "not_retryable"
      | "channel_unavailable"
      | "template_not_found"
      | "template_not_approved"
      | "template_unsupported"
      | "template_params"
      | "media_not_found"
      | "storage_unavailable"
      // Primer mensaje a un contacto sin chat (lib/messaging/start-conversation.ts).
      | "no_phone"
      | "duplicate_phone",
    message: string,
  ) {
    super(message);
    this.name = "SendRejectedError";
  }
}

/** Origen de un saliente de texto: humano desde el CRM, o el Agente IA. */
export type OutboundTextSource = "crm" | "ai_agent";

export type SendTextParams = {
  organizationId: string;
  conversationId: string;
  /** Usuario que envía. null/ausente = sin humano (p. ej. el Agente IA). */
  sentByUserId?: string | null;
  text: string;
  now?: Date;
  /**
   * Id de la fila de `messages` (y clave de idempotencia ante el proveedor).
   * Default: uuid nuevo. El ejecutor de workflows pasa uno DETERMINISTA por
   * (corrida, paso) para que un reintento tras una caída no duplique el envío.
   */
  messageId?: string;
  /** Default "crm". "ai_agent" = respuesta del Agente IA. */
  source?: OutboundTextSource;
  /**
   * Marcar como leídos los entrantes hasta ahora. Default: solo si source es
   * "crm". Un envío automático disparado por un humano que NO está viendo el
   * chat (p. ej. al arrastrar una tarjeta) debe mandar false: si no, una
   * pregunta del cliente desaparece de "No leído" sin que nadie la lea.
   */
  markRead?: boolean;
  /** Solo el web: si hay que esperar (429 o turno), el envío pasa al worker. */
  deferTo?: DeferToWorker;
  /**
   * Lo escribió o lo pidió un VENDEDOR en el chat (composer, programado, "/"). En Instagram
   * solo así se puede contestar entre 24 h y 7 días (docs/instagram.md). Default false.
   */
  humanAgent?: boolean;
  /** Datos extra de la fila (p. ej. `seguimiento`: el intento de un seguimiento del Agente IA). */
  metadata?: Record<string, unknown>;
};

/** "sent": confirmado. "pending": en fila, o resultado desconocido en reconciliación (sin reintento). */
export type SendOutcome = { messageId: string; status: "sent" | "pending" };

export { isAmbiguousSendError, SEND_ACCEPTED, SEND_RATE_LIMITED, SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";
const MAX_TEXT = 4096; // límite de WhatsApp para texto

/**
 * Pasa al worker un envío que debe esperar (429 de Zernio o turno de la
 * conversación). Lo usa el web: la Server Action responde "enviando" al
 * instante y el worker lo manda en su turno (lib/queue/outbox.ts).
 */
export type DeferToWorker = (job: { messageId: string; organizationId: string; readCutoffMessageId: string | null; delayMs: number }) => Promise<void>;
/** Lo que el web espera dentro de la petición antes de pasarle el envío al worker. */
export const WEB_WAIT_BUDGET_MS = 3_000;

type ConversationRow = typeof conversations.$inferSelect;

// enforceWindow=true (texto libre): fuera de la ventana de 24 h solo se permiten
// plantillas. Una plantilla (enforceWindow=false) se manda precisamente cuando
// la ventana está cerrada (ese es su propósito), así que no la valida.
// Instagram (docs/instagram.md): no hay plantillas; de 24 h a 7 días solo puede contestar
// una persona (`human`: lo escribió o lo pidió un vendedor en el chat).
async function loadConversation(
  provider: MessagingProvider,
  organizationId: string,
  conversationId: string,
  now: Date,
  enforceWindow = true,
  human = false,
) {
  const [row] = await db
    .select({ conversation: conversations, channel: channels })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new SendRejectedError("not_found", "Conversación no encontrada");
  // Un canal desactivado no envía, y un canal de otro proveedor (p. ej. ya
  // migrado a Meta directa) no se manda por este adaptador.
  if (!row.channel.isActive || row.channel.provider !== provider.name) {
    throw new SendRejectedError("channel_unavailable", `El canal de ${channelLabel(row.channel.type)} de esta conversación no está disponible`);
  }
  if (enforceWindow && !canSendFreeForm(row.channel.type, row.conversation.windowExpiresAt, now, human)) {
    throw new SendRejectedError("window_closed", windowClosedReason(row.channel.type, row.conversation.windowExpiresAt, now));
  }
  if (!row.conversation.providerConversationId) {
    throw new SendRejectedError("not_linked", "La conversación aún no está enlazada con el proveedor");
  }
  return row;
}

const channelLabel = (type: string) => (type === "instagram" ? "Instagram" : "WhatsApp");

function windowClosedReason(type: string, windowExpires: Date | null, now: Date): string {
  if (type !== "instagram") return "La ventana de 24 h está cerrada: solo se puede enviar una plantilla";
  return canSendFreeForm(type, windowExpires, now, true)
    ? "Pasaron más de 24 h desde el último mensaje del cliente: en Instagram solo un vendedor puede contestar (hasta 7 días); ni el Agente IA ni las automatizaciones."
    : "Pasaron más de 7 días desde el último mensaje del cliente: Instagram no deja escribirle hasta que vuelva a escribir.";
}

type LoadedConversation = Awaited<ReturnType<typeof loadConversation>>;

/** A dónde va el envío y con qué reglas de la red (Instagram: partes y etiqueta de 7 días). */
function sendTarget({ channel, conversation }: LoadedConversation, now: Date, idempotencyKey: string) {
  return {
    providerAccountId: channel.providerAccountId,
    providerConversationId: conversation.providerConversationId!,
    platform: channel.type,
    humanAgentTag: needsHumanAgentTag(channel.type, conversation.windowExpiresAt, now),
    idempotencyKey,
  };
}

// La plantilla debe existir en la organización, pertenecer al canal de la
// conversación y estar APROBADA por Meta. Las del sandbox de Zernio (cuenta ajena)
// no se envían: están ocultas en el CRM (lib/messaging/template-sync.ts).
export async function loadSendableTemplate(
  organizationId: string,
  channel: { id: string; providerAccountId: string },
  templateId: string,
) {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.organizationId, organizationId)))
    .limit(1);
  if (!row || row.channelId !== channel.id || isForeignTemplateAccount(channel.providerAccountId)) {
    throw new SendRejectedError("template_not_found", "La plantilla no existe en el canal de esta conversación.");
  }
  if (!isTemplateSendable(row.status)) {
    throw new SendRejectedError("template_not_approved", "La plantilla no está aprobada por Meta y no se puede enviar.");
  }
  // Defensa en profundidad: la UI ya no ofrece las no soportadas, pero si una
  // llega aquí (params de encabezado/botón), no se envía: WhatsApp la rechazaría.
  if (row.unsupported) {
    throw new SendRejectedError(
      "template_unsupported",
      "Esta plantilla usa variables en el encabezado o botón que el CRM aún no puede enviar.",
    );
  }
  return row;
}

/**
 * Valores de una plantilla listos para mandar: exactamente los {{1..N}} del
 * cuerpo, todos con texto, y la vista previa para la burbuja del hilo.
 */
export function templateSendValues(body: string | null, raw: string[]): { values: string[]; preview: string | null } {
  const expected = templateMaxIndex(body);
  const values = raw.map((value) => value.trim());
  if (values.length !== expected || values.some((value) => value.length === 0)) {
    throw new SendRejectedError(
      "template_params",
      expected === 0 ? "Esta plantilla no lleva variables." : `La plantilla necesita ${expected} variable(s), todas con valor.`,
    );
  }
  return { values, preview: body ? renderTemplateBody(body, values) : null };
}

function validText(raw: string): string {
  const text = raw.trim();
  if (!text) throw new SendRejectedError("empty", "El mensaje está vacío");
  if (text.length > MAX_TEXT) throw new SendRejectedError("empty", `El mensaje excede ${MAX_TEXT} caracteres`);
  return text;
}

export async function sendTextMessage(provider: MessagingProvider, params: SendTextParams): Promise<SendOutcome> {
  const text = validText(params.text);
  const now = params.now ?? new Date();
  const loaded = await loadConversation(provider, params.organizationId, params.conversationId, now, true, params.humanAgent ?? false);
  const { conversation } = loaded;

  const source = params.source ?? "crm";
  const sentByUserId = params.sentByUserId ?? null;
  const messageId = params.messageId ?? crypto.randomUUID();
  await db.insert(messages).values({
    id: messageId,
    organizationId: params.organizationId,
    conversationId: conversation.id,
    direction: "out",
    source,
    type: "text",
    body: text,
    status: "queued",
    sentByUserId,
    sentAt: now,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });
  return deliver({
    messageId,
    send: () => provider.sendText({ ...sendTarget(loaded, now, messageId), text }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId,
    // El agente no "lee" por el vendedor: sus envíos no descuentan no leídos.
    markRead: params.markRead ?? source === "crm",
    deferTo: params.deferTo,
  });
}

export type SendMediaParams = {
  organizationId: string;
  conversationId: string;
  /** Archivo de la biblioteca (media_assets) de la MISMA organización. */
  assetId: string;
  /** Pie de foto / texto que acompaña. */
  caption?: string | null;
  sentByUserId?: string | null;
  source?: OutboundTextSource;
  /** Igual que en SendTextParams. */
  markRead?: boolean;
  messageId?: string;
  now?: Date;
  /** Igual que en SendTextParams (Instagram de 24 h a 7 días). */
  humanAgent?: boolean;
};

// Vida de la URL firmada que descarga el proveedor: suficiente para reintentos
// del proveedor, corta para que no circule.
export const MEDIA_SEND_URL_SECONDS = 15 * 60;

/**
 * Envía un archivo de la biblioteca (Fase D) con el MISMO patrón outbox que el
 * texto: fila "queued" antes de llamar al proveedor (su id = clave de
 * idempotencia) y la clasificación enviado/rechazado/desconocido de `deliver`.
 * Es texto libre para WhatsApp: exige la ventana de 24 h abierta. El archivo
 * viaja por URL firmada temporal; en la burbuja queda el storageKey (la bandeja
 * lo sirve por /api/media/{messageId}/{index} como cualquier adjunto).
 */
export async function sendMediaMessage(provider: MessagingProvider, storage: ObjectStorage, params: SendMediaParams): Promise<SendOutcome> {
  const now = params.now ?? new Date();
  const caption = params.caption?.trim() ? validText(params.caption) : null;
  const loaded = await loadConversation(provider, params.organizationId, params.conversationId, now, true, params.humanAgent ?? false);
  const { conversation } = loaded;
  const asset = await loadMediaAsset(params.organizationId, params.assetId);
  if (!asset) throw new SendRejectedError("media_not_found", "El archivo no existe en la biblioteca de esta organización.");
  let url: string;
  try {
    url = await mediaAssetSignedUrl(storage, asset, MEDIA_SEND_URL_SECONDS);
  } catch (error) {
    throw new SendRejectedError("storage_unavailable", `No se pudo firmar el archivo: ${error instanceof Error ? error.message : String(error)}`);
  }

  const source = params.source ?? "crm";
  const sentByUserId = params.sentByUserId ?? null;
  const messageId = params.messageId ?? crypto.randomUUID();
  await db.insert(messages).values({
    id: messageId,
    organizationId: params.organizationId,
    conversationId: conversation.id,
    direction: "out",
    source,
    type: asset.kind,
    body: caption,
    attachments: [
      {
        type: asset.kind,
        // Ruta interna: la bandeja sirve el archivo por storageKey, nunca por esta URL.
        url: `/api/biblioteca/${asset.id}`,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        storageKey: asset.storageKey,
        sizeBytes: asset.bytes,
        verifiedMime: trustedMediaMime(asset.kind, asset.mimeType),
        downloadedAt: now.toISOString(),
      },
    ],
    mediaUrl: `/api/biblioteca/${asset.id}`,
    mediaMimeType: asset.mimeType,
    status: "queued",
    sentByUserId,
    sentAt: now,
  });
  return deliver({
    messageId,
    send: () =>
      provider.sendMedia({
        ...sendTarget(loaded, now, messageId),
        url,
        kind: asset.kind,
        caption: caption ?? undefined,
        fileName: asset.fileName,
      }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId,
    markRead: params.markRead ?? source === "crm",
  });
}

/**
 * Un archivo que el vendedor manda desde el chat, ya en el bucket: uno que
 * adjuntó (comprobante verificado) o uno de la Biblioteca elegido en
 * Multimedia (30-sep-2026), que trae `messageId` (id por envío, keys.ts).
 */
export type ChatUploadToSend = {
  storageKey: string;
  kind: "image" | "video" | "document";
  mime: string;
  fileName: string;
  bytes: number;
  messageId?: string;
};

/** Marca de los adjuntos del chat en `messages.metadata`: pendiente → enviando (una sola vez). */
export const CHAT_UPLOAD_META = "adjuntoChat";
/**
 * Mientras esperan al worker, los archivos ocupan su lugar en la fila de la
 * conversación (turno de send-turn.ts): un texto o un "/" que el vendedor mande
 * DESPUÉS sale después de ellos. La marca vence sola (worker caído: no frena
 * para siempre); al reclamar cada archivo, sendInTurn pone la suya.
 */
const CHAT_UPLOAD_TURN_BASE_MS = 60_000;
const CHAT_UPLOAD_TURN_PER_FILE_MS = 15_000;
type ChatUploadMeta = { estado: "pendiente" | "enviando"; corte?: string | null };

/**
 * Adjuntos del chat (28-sep-2026), paso 1 (web): valida la conversación y la
 * ventana de 24 h y deja UNA burbuja "queued" por archivo, en el orden en que
 * se ven (sent_at + i ms); el pie va solo en la primera. Nada sale aquí: el
 * worker los manda en orden (sendQueuedChatUpload), así la acción del vendedor
 * responde al instante aunque sean 10 archivos. Id determinista por archivo:
 * mandar dos veces el mismo archivo no crea otra burbuja. Los de la
 * Biblioteca (Multimedia) traen su id por envío: el mismo archivo sí se puede
 * volver a mandar en otro envío.
 */
export async function queueChatUploads(
  provider: MessagingProvider,
  params: { organizationId: string; conversationId: string; sentByUserId: string; files: readonly ChatUploadToSend[]; captions: readonly (string | null)[]; now?: Date },
): Promise<string[]> {
  const now = params.now ?? new Date();
  const captions = params.captions.map((c) => (c?.trim() ? validText(c) : null));
  const { conversation } = await loadConversation(provider, params.organizationId, params.conversationId, now, true, true);
  const ids = params.files.map((f) => f.messageId ?? chatUploadMessageId(f.storageKey));
  const urls = ids.map((id) => `/api/media/${id}/0`);
  // Corte de lectura AL HACER CLIC (no cuando el worker manda): lo que el
  // cliente escriba mientras salen los archivos sigue sin leer.
  const corte = await latestInboundMessageId(conversation.id);
  // Un archivo que ya está en una burbuja de esta conversación no se vuelve a
  // mandar aunque su fila en cola ya no exista (el eco de WhatsApp la sustituyó
  // y se quedó con el adjunto de la cola). Adjunto subido: por su llave (es
  // única). Biblioteca: por la ruta de su burbuja, que lleva el id del envío
  // (la llave es la misma en todos los envíos de ese archivo).
  const uploadKeys = params.files.filter((f) => !f.messageId).map((f) => sql`${f.storageKey}`);
  const libraryUrls = params.files.flatMap((f, i) => (f.messageId ? [sql`${urls[i]}`] : []));
  const sent = await db.execute<{ k: string | null; u: string | null }>(sql`
    select a->>'storageKey' as k, a->>'url' as u from ${messages} m cross join lateral jsonb_array_elements(m.attachments) a
    where m.organization_id = ${params.organizationId} and m.conversation_id = ${conversation.id}
      and m.created_at > ${new Date(now.getTime() - 24 * 3_600_000).toISOString()}::timestamp
      and (${uploadKeys.length ? sql`a->>'storageKey' in (${sql.join(uploadKeys, sql`, `)})` : sql`false`}
        or ${libraryUrls.length ? sql`a->>'url' in (${sql.join(libraryUrls, sql`, `)})` : sql`false`})`);
  const alreadyKeys = new Set(sent.map((r) => r.k));
  const alreadyUrls = new Set(sent.map((r) => r.u));
  await db.transaction(async (tx) => {
    for (const [i, file] of params.files.entries()) {
      if (file.messageId ? alreadyUrls.has(urls[i]) : alreadyKeys.has(file.storageKey)) continue;
      const at = new Date(now.getTime() + i);
      const meta: ChatUploadMeta = { estado: "pendiente", corte };
      const turn: TurnMark = { estado: "espera", hasta: now.getTime() + CHAT_UPLOAD_TURN_BASE_MS + i * CHAT_UPLOAD_TURN_PER_FILE_MS, esperas: 0 };
      const url = urls[i];
      await tx
        .insert(messages)
        .values({
          id: ids[i],
          organizationId: params.organizationId,
          conversationId: conversation.id,
          direction: "out",
          source: "crm",
          type: file.kind,
          body: captions[i] ?? null,
          attachments: [
            {
              type: file.kind,
              url,
              mimeType: file.mime,
              fileName: file.fileName,
              storageKey: file.storageKey,
              sizeBytes: file.bytes,
              verifiedMime: trustedMediaMime(file.kind, file.mime),
              downloadedAt: now.toISOString(),
            },
          ],
          mediaUrl: url,
          mediaMimeType: file.mime,
          status: "queued",
          sentByUserId: params.sentByUserId,
          metadata: { [CHAT_UPLOAD_META]: meta, envio: turn },
          sentAt: at,
          createdAt: at,
        })
        .onConflictDoNothing();
    }
  });
  return ids;
}

/**
 * Adjuntos del chat, paso 2 (worker): manda UN archivo en cola con el mismo
 * patrón outbox (`deliver`: su id es la Idempotency-Key; enviado / rechazado /
 * desconocido). Lo reclama de "pendiente" a "enviando" de forma atómica: un
 * reintento del job nunca lo manda dos veces (si quedó a medias, lo resuelve la
 * conciliación de siempre). Al proveedor le llega una URL firmada corta; en la
 * burbuja queda la ruta interna. Los errores quedan en el mensaje (§7).
 * Devuelve null si no había nada que mandar (ya reclamado o fallido antes de salir).
 */
export async function sendQueuedChatUpload(
  provider: MessagingProvider,
  storage: ObjectStorage,
  params: { organizationId: string; messageId: string; now?: Date },
): Promise<SendOutcome | null> {
  const where = and(eq(messages.id, params.messageId), eq(messages.organizationId, params.organizationId));
  const [row] = await db
    .update(messages)
    // Solo cambia `estado` (conserva el corte de lectura guardado al hacer clic).
    .set({ metadata: sql`jsonb_set(${messages.metadata}, array[${CHAT_UPLOAD_META}::text, 'estado'], '"enviando"'::jsonb)` })
    .where(and(where, eq(messages.status, "queued"), isNull(messages.providerMessageId), sql`${messages.metadata}->${CHAT_UPLOAD_META}->>'estado' = 'pendiente'`))
    .returning();
  if (!row) return null;
  const attachment = row.attachments[0];
  const fail = async (code: string, message: string) => {
    await db.update(messages).set({ status: "failed", errorCode: code, errorMessage: message }).where(where);
    return null;
  };
  if (!attachment?.storageKey || (row.type !== "image" && row.type !== "video" && row.type !== "document")) {
    return fail("media_not_found", "El archivo adjunto no está disponible.");
  }
  let loaded: LoadedConversation;
  const sendNow = params.now ?? new Date();
  try {
    loaded = await loadConversation(provider, params.organizationId, row.conversationId, sendNow, true, true);
  } catch (error) {
    if (error instanceof SendRejectedError) return fail(error.code, error.message);
    // Falla de infraestructura ANTES de llamar al proveedor: se devuelve a
    // "pendiente" para que el reintento del job sí lo mande (no salió nada).
    await db
      .update(messages)
      .set({ metadata: sql`jsonb_set(${messages.metadata}, array[${CHAT_UPLOAD_META}::text, 'estado'], '"pendiente"'::jsonb)` })
      .where(where)
      .catch(() => undefined);
    throw error;
  }
  let url: string;
  try {
    url = await storage.signedGetUrl(attachment.storageKey, MEDIA_SEND_URL_SECONDS, attachment.fileName, "inline");
  } catch (error) {
    // El detalle (endpoint, bucket) va al log; en la burbuja, un motivo simple.
    console.error(`[adjuntos] no se pudo firmar ${row.id}`, error);
    return fail("storage_unavailable", "El almacenamiento de archivos no respondió; vuelve a adjuntarlo.");
  }
  const { conversation } = loaded;
  const kind = row.type;
  const corte = (row.metadata?.[CHAT_UPLOAD_META] as ChatUploadMeta | undefined)?.corte;
  return deliver({
    messageId: row.id,
    send: () =>
      provider.sendMedia({
        ...sendTarget(loaded, sendNow, row.id),
        url,
        kind,
        caption: row.body ?? undefined,
        fileName: attachment.fileName,
      }),
    now: row.sentAt ?? row.createdAt,
    conversation,
    organizationId: params.organizationId,
    sentByUserId: row.sentByUserId,
    // Undefined (filas viejas sin corte) = deliver lo calcula como siempre.
    readCutoffMessageId: corte,
  });
}

export type SendTemplateParams = {
  organizationId: string;
  conversationId: string;
  /** null = sin humano: un seguimiento del Agente IA (`source: "ai_agent"`). */
  sentByUserId: string | null;
  templateId: string;
  /** Default "crm". "ai_agent" = seguimiento del Agente IA (no cuenta como respuesta humana). */
  source?: OutboundTextSource;
  /** Id de la fila (y clave de idempotencia). Default: uuid nuevo. */
  messageId?: string;
  /** Datos extra de la fila, además de `plantilla` (p. ej. `seguimiento`). */
  metadata?: Record<string, unknown>;
  /** Valores de las variables del BODY en orden ({{1}}, {{2}}, …). */
  variableValues: string[];
  now?: Date;
  deferTo?: DeferToWorker;
};

/**
 * Envía una plantilla aprobada (para FUERA de la ventana de 24 h). Mismo patrón
 * outbox que el texto: fila "queued" ANTES de llamar al proveedor (su id es la
 * clave de idempotencia), y luego la misma clasificación enviado/rechazado/
 * desconocido de `deliver`. NO valida la ventana (una plantilla se manda cuando
 * está cerrada) y NO mueve `window_expires_at` (eso solo lo hace un entrante).
 * La burbuja guarda el BODY ya rellenado y `template_name`.
 */
export async function sendTemplateMessage(provider: MessagingProvider, params: SendTemplateParams): Promise<SendOutcome> {
  const now = params.now ?? new Date();
  const { conversation, channel } = await loadConversation(
    provider,
    params.organizationId,
    params.conversationId,
    now,
    false,
  );
  if (channel.type !== "whatsapp") {
    throw new SendRejectedError("template_not_found", "Instagram no tiene plantillas: contesta con texto (hasta 7 días desde el último mensaje del cliente).");
  }
  const template = await loadSendableTemplate(params.organizationId, channel, params.templateId);
  const { values, preview } = templateSendValues(template.body, params.variableValues);

  const messageId = params.messageId ?? crypto.randomUUID();
  await db.insert(messages).values({
    id: messageId,
    organizationId: params.organizationId,
    conversationId: conversation.id,
    direction: "out",
    source: params.source ?? "crm",
    type: "template",
    body: preview,
    templateName: template.name,
    // Lo que hace falta para mandarla de nuevo con la misma clave si el envío
    // pasa a la fila de espera del worker (resumeDeferredSend).
    metadata: { ...(params.metadata ?? {}), plantilla: { name: template.name, language: template.language, bodyParams: values } },
    status: "queued",
    sentByUserId: params.sentByUserId,
    sentAt: now,
  });
  return deliver({
    messageId,
    send: () =>
      provider.sendTemplate({
        providerAccountId: channel.providerAccountId,
        providerConversationId: conversation.providerConversationId!,
        name: template.name,
        language: template.language,
        bodyParams: values,
        idempotencyKey: messageId,
      }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId: params.sentByUserId,
    // Un seguimiento del Agente IA no "lee" por el vendedor.
    markRead: params.source === "ai_agent" ? false : undefined,
    deferTo: params.deferTo,
  });
}

/**
 * ⚠ Reintentar: SOLO un mensaje "failed" por rechazo DEFINITIVO del proveedor
 * (4xx: el mensaje no salió). Un fallo ambiguo (timeout, 5xx, sin confirmar)
 * NO se reintenta: Zernio libera la clave de idempotencia al fallar, así que
 * reenviar podría duplicar el mensaje al cliente. Para esos, el vendedor
 * revisa el chat y escribe de nuevo (mensaje nuevo, clave nueva).
 */
export async function retryTextMessage(
  provider: MessagingProvider,
  params: { organizationId: string; messageId: string; sentByUserId: string; now?: Date; deferTo?: DeferToWorker },
): Promise<SendOutcome> {
  const now = params.now ?? new Date();
  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, params.messageId), eq(messages.organizationId, params.organizationId)))
    .limit(1);
  if (!message) throw new SendRejectedError("not_found", "Mensaje no encontrado");
  if (message.direction !== "out" || message.source !== "crm" || message.type !== "text" || !message.body) {
    throw new SendRejectedError("not_retryable", "Solo se reintentan textos enviados desde el CRM");
  }
  // Un envío ambiguo (no se sabe si llegó) NO se reintenta: podría duplicar.
  if (isAmbiguousSendError(message.errorCode)) {
    throw new SendRejectedError(
      "not_retryable",
      "No se sabe si este mensaje llegó. Revisa el chat en el celular y, si no llegó, escríbelo de nuevo.",
    );
  }
  const loaded = await loadConversation(provider, params.organizationId, message.conversationId, now, true, true);
  const { conversation } = loaded;

  // Paso atómico failed → queued: dos clics simultáneos no envían dos veces.
  const claimed = await db
    .update(messages)
    .set({ status: "queued", errorCode: null, errorMessage: null, sentByUserId: params.sentByUserId, sentAt: now })
    .where(
      and(
        eq(messages.id, message.id),
        eq(messages.organizationId, params.organizationId),
        eq(messages.status, "failed"),
        isNull(messages.providerMessageId),
      ),
    )
    .returning({ id: messages.id });
  // Un "failed" CON wamid lo rechazó WhatsApp después de aceptarlo: con la
  // misma clave Zernio devolvería la respuesta guardada sin reenviar. Ese se
  // escribe de nuevo (mensaje nuevo), no se reintenta.
  if (claimed.length === 0) throw new SendRejectedError("not_retryable", "El mensaje ya se envió, se está enviando o WhatsApp lo rechazó");

  return deliver({
    messageId: message.id,
    send: () => provider.sendText({ ...sendTarget(loaded, now, message.id), text: message.body! }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId: params.sentByUserId,
    deferTo: params.deferTo,
  });
}

/**
 * Worker: manda un envío que el web pasó a la fila de espera (429 de Zernio o
 * turno de la conversación). Misma fila y MISMA clave de idempotencia: un 429
 * garantiza que Zernio no lo procesó, así que no puede duplicar. Si la fila ya
 * se resolvió (salió, falló o es ambigua) no hace nada. Solo texto y plantilla:
 * el web no manda archivos.
 */
export async function resumeDeferredSend(
  provider: MessagingProvider,
  params: { organizationId: string; messageId: string; readCutoffMessageId: string | null; sleep?: (ms: number) => Promise<void> },
): Promise<SendOutcome | null> {
  const where = and(eq(messages.id, params.messageId), eq(messages.organizationId, params.organizationId));
  const [row] = await db.select().from(messages).where(where).limit(1);
  // Solo una fila en "espera" (su último intento fue un 429 o aún no salía): una
  // en "enviando" se cortó a la mitad de la llamada a Zernio y es ambigua.
  const envio = row?.metadata?.envio as { estado?: string } | undefined;
  if (
    !row ||
    row.direction !== "out" ||
    row.status !== "queued" ||
    row.providerMessageId ||
    row.providerInternalId ||
    row.errorCode ||
    envio?.estado !== "espera"
  ) {
    return null;
  }
  const plantilla = row.metadata?.plantilla as { name?: string; language?: string; bodyParams?: string[] } | undefined;
  if (row.type !== "text" && !(row.type === "template" && plantilla?.name && plantilla.language)) {
    await db.update(messages).set({ status: "failed", errorCode: SEND_RATE_LIMITED, errorMessage: "No se pudo retomar el envío en espera." }).where(where);
    return null;
  }
  let loaded: LoadedConversation;
  const resumedAt = new Date();
  try {
    // Sin revisar la ventana: se revisó al escribirlo; si cerró mientras esperaba, WhatsApp lo dirá.
    loaded = await loadConversation(provider, params.organizationId, row.conversationId, resumedAt, false);
  } catch (error) {
    if (!(error instanceof SendRejectedError)) throw error;
    await db.update(messages).set({ status: "failed", errorCode: error.code, errorMessage: error.message }).where(where);
    return null;
  }
  const { conversation } = loaded;
  // Lo diferido es del composer (un vendedor): en Instagram, fuera de 24 h lleva la etiqueta.
  const target = sendTarget(loaded, resumedAt, row.id);
  return deliver({
    messageId: row.id,
    send: () =>
      row.type === "text"
        ? provider.sendText({ ...target, text: row.body ?? "" })
        : provider.sendTemplate({ ...target, name: plantilla!.name!, language: plantilla!.language!, bodyParams: plantilla!.bodyParams ?? [] }),
    now: row.sentAt ?? row.createdAt,
    conversation,
    organizationId: params.organizationId,
    sentByUserId: row.sentByUserId,
    readCutoffMessageId: params.readCutoffMessageId,
    sleep: params.sleep,
  });
}

/**
 * Una burbuja del Agente IA con id DETERMINISTA (Agente IA parte 1, 26-sep-2026):
 * el id es la fila de `messages` y la Idempotency-Key. La 1ª vez es igual que
 * sendTextMessage. En "Reintentar" (respuesta guardada, lib/ai/runtime/saved-reply.ts)
 * la fila ya existe y se reenvía el MISMO texto con la MISMA clave:
 * - ya salió (wamid, o sent/delivered/read) → no se vuelve a mandar;
 * - rechazada, o nunca confirmada por un error NUESTRO (queued sin código) → se
 *   reenvía: si Zernio sí la había aceptado, su clave (24 h) devuelve la respuesta
 *   guardada en vez de mandar otro mensaje;
 * - resultado AMBIGUO de Zernio (5xx/timeout, o nunca confirmado) → no se reenvía:
 *   Zernio libera la clave al fallar y podría llegar dos veces.
 */
export async function sendAgentText(
  provider: MessagingProvider,
  params: { organizationId: string; conversationId: string; text: string; messageId: string; now?: Date },
): Promise<SendOutcome> {
  // Último candado (5-oct-2026, dueño): TODO texto del Agente IA pasa por aquí (respuesta,
  // «Reintentar», lo que venga). Un texto interno («[tool call] …») nunca sale, aunque se
  // haya colado antes del candado de run.ts (unfinishedReply).
  const internal = findInternalText([params.text]);
  if (internal) {
    throw new SendRejectedError("not_retryable", `El Agente IA escribió una nota interna (${internal.reason}) y no se envió.`);
  }
  const now = params.now ?? new Date();
  const where = and(eq(messages.id, params.messageId), eq(messages.organizationId, params.organizationId));
  const [prior] = await db
    .select({
      conversationId: messages.conversationId,
      direction: messages.direction,
      source: messages.source,
      status: messages.status,
      errorCode: messages.errorCode,
      providerMessageId: messages.providerMessageId,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(where)
    .limit(1);
  if (!prior) {
    return sendTextMessage(provider, { ...params, source: "ai_agent", sentByUserId: null, now });
  }
  if (prior.conversationId !== params.conversationId || prior.direction !== "out" || prior.source !== "ai_agent") {
    throw new SendRejectedError("not_retryable", "El mensaje guardado no es una respuesta del agente en esta conversación.");
  }
  if (prior.providerMessageId || prior.status === "sent" || prior.status === "delivered" || prior.status === "read") {
    return { messageId: params.messageId, status: "sent" };
  }
  // Una fila en cola vieja ya no es "nuestro error de hace un momento": pudo salir y la
  // clave de Zernio vence a las 24 h. Se trata igual que el barrido (expireUnconfirmedSends):
  // sin confirmar, no se reenvía.
  const staleQueued = prior.status === "queued" && (prior.sentAt ?? new Date(0)).getTime() < now.getTime() - SEND_UNCONFIRMED_AFTER_MS;
  if (isAmbiguousSendError(prior.errorCode) || staleQueued) {
    throw new SendRejectedError("not_retryable", "WhatsApp no confirmó si la respuesta le llegó al cliente; reenviarla podría duplicarla.");
  }
  const text = validText(params.text);
  // La ventana y el canal se revisan ANTES de reclamar la fila: fuera de la ventana
  // la fila se queda como estaba y la tarjeta explica el motivo.
  const loaded = await loadConversation(provider, params.organizationId, params.conversationId, now);
  const { conversation } = loaded;
  const claimed = await db
    .update(messages)
    .set({ status: "queued", errorCode: null, errorMessage: null, body: text, sentAt: now })
    .where(and(where, isNull(messages.providerMessageId), inArray(messages.status, ["failed", "queued"])))
    .returning({ id: messages.id });
  if (claimed.length === 0) throw new SendRejectedError("not_retryable", "La respuesta ya se envió o se está enviando.");
  return deliver({
    messageId: params.messageId,
    send: () => provider.sendText({ ...sendTarget(loaded, now, params.messageId), text }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId: null,
    markRead: false,
  });
}

// Envía (texto o plantilla, vía la closure `send`) y clasifica el resultado
// igual para ambos: enviado → enlaza el wamid; rechazado (4xx) → "failed" con su
// código; desconocido (timeout/5xx/2xx sin id) → queda "queued" y se reconcilia.
// Un 429 no es ninguno de los tres: el envío espera su turno y se repite con la
// misma clave (send-turn.ts). En el web, si hay que esperar, pasa al worker.
async function deliver(
  ctx: {
    messageId: string;
    send: () => Promise<SendResult>;
    now: Date;
    conversation: ConversationRow;
    organizationId: string;
    sentByUserId: string | null;
    /** Default true. false = no marca como leídos los entrantes (envío del agente). */
    markRead?: boolean;
    /** Corte de lectura ya decidido (envío retomado por el worker). */
    readCutoffMessageId?: string | null;
    /** Web: si hay que esperar (429 o turno), el envío pasa al worker. */
    deferTo?: DeferToWorker;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<SendOutcome> {
  const where = and(eq(messages.id, ctx.messageId), eq(messages.organizationId, ctx.organizationId));
  // Corte de lectura: el último entrante que el vendedor tenía a la vista al
  // enviar. Lo que entre después sigue sin leer (aunque haya otros envíos).
  const readCutoffMessageId =
    ctx.readCutoffMessageId !== undefined
      ? ctx.readCutoffMessageId
      : ctx.markRead === false
        ? null
        : await latestInboundMessageId(ctx.conversation.id);
  const deferTo = ctx.deferTo;
  let result: SendResult;
  try {
    const turn = await sendInTurn({
      messageId: ctx.messageId,
      organizationId: ctx.organizationId,
      conversationId: ctx.conversation.id,
      send: ctx.send,
      sleep: ctx.sleep,
      defer: deferTo && {
        budgetMs: WEB_WAIT_BUDGET_MS,
        enqueue: (delayMs) =>
          deferTo({ messageId: ctx.messageId, organizationId: ctx.organizationId, readCutoffMessageId, delayMs }).catch((error: unknown) =>
            // El barrido del worker recoge los diferidos sin job (expireUnconfirmedSends no los toca antes).
            console.error(`[send] no se pudo pasar ${ctx.messageId} al worker; lo recoge el barrido`, error),
          ),
      },
    });
    // El vendedor ve "enviando"; el worker lo manda en su turno con la misma clave.
    if (turn.kind === "deferred") return { messageId: ctx.messageId, status: "pending" };
    result = turn.result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Cualquier error que no sea un rechazo EXPLÍCITO del proveedor se trata
    // como desconocido: es preferible verificar que duplicar.
    if (error instanceof SendFailedError && error.outcome === "rejected") {
      await db.update(messages).set({ status: "failed", errorCode: error.code, errorMessage: reason }).where(where);
      throw error;
    }
    const code = error instanceof SendFailedError ? `${SEND_UNKNOWN}:${error.code}` : SEND_UNKNOWN;
    await db.update(messages).set({ errorCode: code, errorMessage: reason }).where(where);
    console.error(`[send] resultado desconocido para ${ctx.messageId}; se reconciliará: ${reason}`);
    // El eco pudo llegar MIENTRAS el POST seguía colgado (Zernio sí lo mandó): se fusiona
    // como cualquier "eco primero" (lib/messaging/late-echo.ts). Si llega después, lo une
    // la ingesta (adoptLateEcho).
    try {
      const early = await findEarlyEcho(db, ctx.organizationId, ctx.messageId);
      if (early) {
        const finalId = await linkSentMessage({
          queuedId: ctx.messageId,
          conversationId: ctx.conversation.id,
          organizationId: ctx.organizationId,
          sentByUserId: ctx.sentByUserId,
          providerMessageId: early.providerMessageId,
          providerInternalId: early.providerInternalId ?? undefined,
          status: "sent",
          sentAt: early.sentAt,
          readCutoffMessageId,
        });
        console.info(`[send] ${ctx.messageId}: su eco ya había llegado; queda enviado (${finalId})`);
        return { messageId: finalId, status: "sent" };
      }
    } catch (linkError) {
      console.error(`[send] ${ctx.messageId}: no se pudo unir con su eco; se reconciliará`, linkError);
    }
    return { messageId: ctx.messageId, status: "pending" };
  }

  // Desde aquí Zernio YA ACEPTÓ el envío: nada de lo que falle después puede
  // volverlo "error" (el vendedor lo escribiría otra vez y el cliente lo
  // recibiría dos veces). Si guardar la confirmación falla, queda "enviando" con
  // los ids que se puedan guardar; nunca se reenvía solo, y si no se confirma,
  // el barrido deja la tarjeta explicada (expireUnconfirmedSends).
  try {
    const finalId = await linkSentMessage({
      queuedId: ctx.messageId,
      conversationId: ctx.conversation.id,
      organizationId: ctx.organizationId,
      sentByUserId: ctx.sentByUserId,
      providerMessageId: result.providerMessageId,
      providerInternalId: result.providerInternalId,
      status: "sent",
      sentAt: ctx.now,
      readCutoffMessageId,
      extraProviderMessageIds: result.extraProviderMessageIds,
      warning: result.warning,
    });
    return { messageId: finalId, status: "sent" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[send] Zernio aceptó ${ctx.messageId} pero no se pudo guardar la confirmación; queda "enviando": ${reason}`);
    await saveAcceptedSend(ctx.messageId, ctx.organizationId, result, reason);
    return { messageId: ctx.messageId, status: "pending" };
  }
}

/**
 * Zernio aceptó y falló la base al enlazar: se guardan los ids (si se puede) y
 * la marca SEND_ACCEPTED (ambiguo: sin "Reintentar"). Con los ids, el eco y los
 * estados de WhatsApp lo confirman solos (ingest.ts). Varios intentos: una caída
 * de la base suele durar poco. Si ni así se pudo, la fila queda "enviando" sin
 * marca y el barrido la resuelve como cualquier envío sin confirmar.
 */
export async function saveAcceptedSend(messageId: string, organizationId: string, result: SendResult, reason: string): Promise<void> {
  const where = and(eq(messages.id, messageId), eq(messages.organizationId, organizationId), eq(messages.status, "queued"));
  const errorMessage = `Zernio aceptó el envío, pero el CRM no pudo guardar la confirmación: ${reason}`.slice(0, 500);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Con los ids primero; si chocan (el eco ya los tiene en otra fila), sin ellos.
      const ids =
        attempt === 0
          ? { providerMessageId: result.providerMessageId ?? null, providerInternalId: result.providerInternalId }
          : {};
      await db.update(messages).set({ errorCode: SEND_ACCEPTED, errorMessage, ...ids }).where(where);
      return;
    } catch (error) {
      console.error(`[send] no se pudo marcar ${messageId} como aceptado (intento ${attempt + 1})`, error);
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

export class SendConflictError extends Error {}

/**
 * Enlaza una fila en cola con el mensaje que el proveedor confirmó y, en la
 * MISMA transacción, actualiza la conversación (último mensaje, primera
 * respuesta, no leídos hasta el corte): un corte a la mitad no deja el
 * mensaje enviado con la conversación vieja. Orden de bloqueo: conversación
 * → mensajes, igual que la ingesta.
 *
 * Si el eco del webhook ya creó OTRA fila con ese wamid, esa se queda (con la
 * autoría del vendedor) y la de la cola se borra: nunca dos burbujas del mismo
 * envío. Nunca se fusionan dos envíos del CRM: si el wamid ya es de otra fila
 * "crm", se lanza SendConflictError y la fila en cola queda como estaba.
 * Devuelve el id que sobrevive.
 */
export async function linkSentMessage(input: {
  queuedId: string;
  conversationId: string;
  organizationId: string;
  sentByUserId: string | null;
  providerMessageId?: string;
  providerInternalId?: string;
  status: "sent" | "delivered" | "read" | "failed";
  sentAt: Date;
  /** null = no descontar no leídos (p. ej. la reconciliación del worker). */
  readCutoffMessageId: string | null;
  /** Instagram: ids de las otras partes del mismo envío (pie, resto del texto). */
  extraProviderMessageIds?: string[];
  /** Salió incompleto (una parte no salió): se muestra en la burbuja. */
  warning?: string;
}): Promise<string> {
  const link = () =>
    db.transaction(async (tx) => {
      await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)))
        .for("update");
      const queuedWhere = and(eq(messages.id, input.queuedId), eq(messages.organizationId, input.organizationId));
      const [queued] = await tx.select().from(messages).where(queuedWhere).for("update");
      if (!queued) throw new Error(`mensaje en cola ${input.queuedId} no existe`);
      let survivor = queued.id;
      // El eco del webhook pudo llegar primero. Se busca por wamid O por el id
      // interno del proveedor (Zernio a veces confirma el envío devolviendo
      // SOLO el id interno, sin wamid): en ese caso el eco ya tiene ese id
      // interno y buscar solo por wamid lo dejaría escapar, y escribirlo en la
      // fila en cola chocaría con el índice único (organización, id interno).
      const echoMatchers = [
        input.providerMessageId ? eq(messages.providerMessageId, input.providerMessageId) : undefined,
        input.providerInternalId ? eq(messages.providerInternalId, input.providerInternalId) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);
      const [echo] = echoMatchers.length
        ? await tx
            .select({ id: messages.id, status: messages.status, source: messages.source, attachments: messages.attachments })
            .from(messages)
            .where(and(eq(messages.organizationId, input.organizationId), or(...echoMatchers)))
            .for("update")
        : [];
      if (echo && echo.id !== queued.id) {
        // Otro envío originado en el CRM (humano o agente) nunca se fusiona.
        if (echo.source === "crm" || echo.source === "ai_agent") {
          throw new SendConflictError(`el wamid ${input.providerMessageId} ya pertenece al envío ${echo.id}`);
        }
        // El eco del webhook se clasifica por su contenido (texto/adjunto), sin
        // la metadata de lo que el CRM envió. Al fusionarlo se copian type, body
        // y template_name de la fila en cola: sin esto, un envío de PLANTILLA
        // sobreviviría como "text"/"unknown" sin nombre de plantilla (se pierde
        // el historial y la auditoría). Para un texto son idénticos (no-op).
        await tx
          .update(messages)
          .set({
            // La autoría es la de la fila en cola ("crm" o "ai_agent").
            source: queued.source,
            sentByUserId: input.sentByUserId,
            status: nextStatus(echo.status, input.status),
            type: queued.type,
            body: queued.body,
            templateName: queued.templateName,
            // Media de la BIBLIOTECA (Fase D): la fila en cola ya trae el
            // storageKey; el eco trae la URL del proveedor y dispararía una
            // descarga que puede fallar ("procesando"/"no se pudo descargar" y
            // el vendedor lo reenvía). Se conserva el adjunto propio.
            ...(queued.attachments.some((a) => a.storageKey) && !echo.attachments.some((a) => a.storageKey)
              ? { attachments: queued.attachments, mediaUrl: queued.mediaUrl, mediaMimeType: queued.mediaMimeType }
              : {}),
          })
          .where(eq(messages.id, echo.id));
        await tx.delete(messages).where(queuedWhere);
        survivor = echo.id;
      } else {
        await tx
          .update(messages)
          .set({
            status: nextStatus(queued.status, input.status),
            errorCode: null,
            errorMessage: null,
            providerMessageId: input.providerMessageId ?? queued.providerMessageId,
            providerInternalId: input.providerInternalId ?? queued.providerInternalId,
          })
          .where(queuedWhere);
      }
      if (input.extraProviderMessageIds?.length || input.warning) {
        await recordInstagramParts(tx, input.organizationId, input.conversationId, survivor, input.extraProviderMessageIds ?? [], input.warning);
      }
      await applyOutboundToConversation(tx, input.conversationId, input.sentAt, input.readCutoffMessageId);
      return survivor;
    });
  // withTxRetry cubre deadlock/serialización (40P01/40001); el 23505 es la
  // carrera del eco insertándose entre la búsqueda y el UPDATE: al repetir, la
  // búsqueda ya lo encuentra.
  return withTxRetry(async () => {
    try {
      return await link();
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      return link();
    }
  });
}

type LinkTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Instagram (docs/instagram.md): un envío del CRM puede salir como VARIOS mensajes de Meta
 * (archivo + pie, o un texto largo en partes) y cada uno trae su eco. La burbuja es una:
 * los ids de las otras partes se guardan en ella (así sus ecos se reconocen en la ingesta)
 * y, si algún eco llegó ANTES y se guardó como otro mensaje, se borra.
 */
async function recordInstagramParts(tx: LinkTx, organizationId: string, conversationId: string, messageId: string, extra: string[], warning?: string) {
  const patch: Record<string, unknown> = {};
  if (extra.length) patch[INSTAGRAM_PARTS_META] = extra;
  if (warning) patch[SEND_WARNING_META] = warning;
  await tx
    .update(messages)
    .set({ metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)));
  if (extra.length) {
    await tx
      .delete(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "out"),
          eq(messages.source, "other_api"),
          inArray(messages.providerMessageId, extra),
        ),
      );
  }
}

// Un envío de resultado desconocido que siguió sin confirmarse (ni por la
// respuesta ni por el eco) tras este tiempo pasa a "failed" y se puede revisar.
export const SEND_UNCONFIRMED_AFTER_MS = 15 * 60_000;

/**
 * Barrido del worker: envíos del CRM que siguen "queued" sin confirmar tras
 * SEND_UNCONFIRMED_AFTER_MS desde su último intento pasan a "failed":
 * - SEND_ACCEPTED (Zernio lo aceptó y falló la base al guardar la confirmación):
 *   casi seguro salió. Se queda sin "Reintentar" y deja una TARJETA en el chat
 *   que explica qué pasó (Bloque B). Si después llega "entregado"/"leído", el
 *   mensaje se corrige solo (ingest.ts).
 * - en "espera" (su último intento fue un 429 y el proceso se reinició antes de
 *   repetirlo): no salió; SEND_RATE_LIMITED, sí se puede reintentar.
 * - el resto (resultado desconocido, o el proceso murió tras el POST):
 *   send_unconfirmed, sin "Reintentar".
 *
 * NO se intenta adivinar cuál saliente del proveedor es: Zernio no acepta un
 * id de correlación propio, y emparejar por texto y hora podría atribuirle al
 * vendedor un mensaje ajeno. Si el envío sí salió, su eco ya está en el hilo
 * (el vendedor lo ve). No se ofrece "Reintentar" para un envío sin confirmar:
 * Zernio libera la clave al fallar, así que reintentar podría duplicar; el
 * vendedor revisa el chat y, si no llegó, lo escribe de nuevo.
 */
export async function expireUnconfirmedSends(now = new Date()): Promise<number> {
  const stale = and(
    eq(messages.direction, "out"),
    inArray(messages.source, ["crm", "ai_agent"]),
    eq(messages.status, "queued"),
    // sent_at = último intento (un reintento lo renueva), no la creación.
    lt(messages.sentAt, new Date(now.getTime() - SEND_UNCONFIRMED_AFTER_MS)),
    // Un adjunto del chat que aún espera al worker nunca se intentó: no es "sin
    // confirmar" (lo resuelve expireStuckChatUploads con su propio motivo).
    sql`coalesce(${messages.metadata}->${CHAT_UPLOAD_META}->>'estado', '') <> 'pendiente'`,
  );
  const accepted = await db
    .update(messages)
    .set({ status: "failed", errorMessage: plainSendReason(SEND_ACCEPTED) })
    .where(and(stale, eq(messages.errorCode, SEND_ACCEPTED)))
    .returning({ id: messages.id, organizationId: messages.organizationId, conversationId: messages.conversationId, body: messages.body });
  for (const row of accepted) {
    await addNotice({
      organizationId: row.organizationId,
      conversationId: row.conversationId,
      messageId: row.id,
      kind: "envio",
      body: `WhatsApp sí recibió el mensaje${row.body ? ` «${row.body.slice(0, 120)}»` : ""}, pero el CRM no pudo confirmar que le llegó al cliente. Revísalo en el celular antes de volver a escribirlo: si ya le llegó, no lo mandes otra vez.`,
    });
  }
  const waiting = await db
    .update(messages)
    .set({ status: "failed", errorCode: SEND_RATE_LIMITED, errorMessage: "No salió: WhatsApp pidió esperar y el envío no se completó." })
    .where(
      and(
        stale,
        isNull(messages.providerMessageId),
        isNull(messages.providerInternalId),
        isNull(messages.errorCode),
        sql`${messages.metadata}->'envio'->>'estado' = 'espera'`,
      ),
    )
    .returning({ id: messages.id });
  const expired = await db
    .update(messages)
    .set({
      status: "failed",
      errorCode: SEND_UNCONFIRMED,
      errorMessage: "WhatsApp no confirmó el envío. Revisa el chat antes de reintentar.",
    })
    .where(and(stale, isNull(messages.providerMessageId)))
    .returning({ id: messages.id });
  return accepted.length + waiting.length + expired.length;
}
