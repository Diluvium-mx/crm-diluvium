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
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { withTxRetry } from "@/lib/db/retry";
import { channels, conversations, messages, templates } from "@/lib/db/schema";
import { applyOutboundToConversation, latestInboundMessageId } from "./ingest";
import { SendFailedError, type MessagingProvider, type SendResult } from "./provider";
import { isAmbiguousSendError, isWindowOpen, nextStatus, SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";
import { renderTemplateBody, templateMaxIndex } from "./template-format";
import { loadMediaAsset, mediaAssetSignedUrl } from "@/lib/media-library/service";
import type { ObjectStorage } from "@/lib/storage/s3";
import { isTemplateSendable } from "@/lib/templates/types";

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
      | "storage_unavailable",
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
  /** Default "crm". "ai_agent" = respuesta del Agente IA. */
  source?: OutboundTextSource;
  /**
   * Marcar como leídos los entrantes hasta ahora. Default: solo si source es
   * "crm". Un envío automático disparado por un humano que NO está viendo el
   * chat (p. ej. al arrastrar una tarjeta) debe mandar false: si no, una
   * pregunta del cliente desaparece de "No leído" sin que nadie la lea.
   */
  markRead?: boolean;
};

/** "sent": confirmado. "pending": resultado desconocido, en reconciliación (sin reintento). */
export type SendOutcome = { messageId: string; status: "sent" | "pending" };

export { isAmbiguousSendError, SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";
const MAX_TEXT = 4096; // límite de WhatsApp para texto

type ConversationRow = typeof conversations.$inferSelect;

// enforceWindow=true (texto libre): fuera de la ventana de 24 h solo se permiten
// plantillas. Una plantilla (enforceWindow=false) se manda precisamente cuando
// la ventana está cerrada (ese es su propósito), así que no la valida.
async function loadConversation(
  provider: MessagingProvider,
  organizationId: string,
  conversationId: string,
  now: Date,
  enforceWindow = true,
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
    throw new SendRejectedError("channel_unavailable", "El canal de WhatsApp de esta conversación no está disponible");
  }
  if (enforceWindow && !isWindowOpen(row.conversation.windowExpiresAt, now)) {
    throw new SendRejectedError("window_closed", "La ventana de 24 h está cerrada: solo se puede enviar una plantilla");
  }
  if (!row.conversation.providerConversationId) {
    throw new SendRejectedError("not_linked", "La conversación aún no está enlazada con el proveedor");
  }
  return row;
}

// La plantilla debe existir en la organización, pertenecer al canal de la
// conversación y estar APROBADA por Meta.
async function loadSendableTemplate(organizationId: string, channelId: string, templateId: string) {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.organizationId, organizationId)))
    .limit(1);
  if (!row || row.channelId !== channelId) {
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

function validText(raw: string): string {
  const text = raw.trim();
  if (!text) throw new SendRejectedError("empty", "El mensaje está vacío");
  if (text.length > MAX_TEXT) throw new SendRejectedError("empty", `El mensaje excede ${MAX_TEXT} caracteres`);
  return text;
}

export async function sendTextMessage(provider: MessagingProvider, params: SendTextParams): Promise<SendOutcome> {
  const text = validText(params.text);
  const now = params.now ?? new Date();
  const { conversation, channel } = await loadConversation(provider, params.organizationId, params.conversationId, now);

  const source = params.source ?? "crm";
  const sentByUserId = params.sentByUserId ?? null;
  const messageId = crypto.randomUUID();
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
  });
  return deliver({
    messageId,
    send: () =>
      provider.sendText({
        providerAccountId: channel.providerAccountId,
        providerConversationId: conversation.providerConversationId!,
        text,
        idempotencyKey: messageId,
      }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId,
    // El agente no "lee" por el vendedor: sus envíos no descuentan no leídos.
    markRead: params.markRead ?? source === "crm",
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
  now?: Date;
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
  const { conversation, channel } = await loadConversation(provider, params.organizationId, params.conversationId, now);
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
  const messageId = crypto.randomUUID();
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
        providerAccountId: channel.providerAccountId,
        providerConversationId: conversation.providerConversationId!,
        url,
        kind: asset.kind,
        caption: caption ?? undefined,
        fileName: asset.fileName,
        idempotencyKey: messageId,
      }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId,
    markRead: params.markRead ?? source === "crm",
  });
}

export type SendTemplateParams = {
  organizationId: string;
  conversationId: string;
  sentByUserId: string;
  templateId: string;
  /** Valores de las variables del BODY en orden ({{1}}, {{2}}, …). */
  variableValues: string[];
  now?: Date;
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
  const template = await loadSendableTemplate(params.organizationId, channel.id, params.templateId);

  // Los valores deben ser exactamente los {{1..N}} del cuerpo, todos con texto.
  const expected = templateMaxIndex(template.body);
  const values = params.variableValues.map((value) => value.trim());
  if (values.length !== expected || values.some((value) => value.length === 0)) {
    throw new SendRejectedError(
      "template_params",
      expected === 0
        ? "Esta plantilla no lleva variables."
        : `La plantilla necesita ${expected} variable(s), todas con valor.`,
    );
  }
  const preview = template.body ? renderTemplateBody(template.body, values) : null;

  const messageId = crypto.randomUUID();
  await db.insert(messages).values({
    id: messageId,
    organizationId: params.organizationId,
    conversationId: conversation.id,
    direction: "out",
    source: "crm",
    type: "template",
    body: preview,
    templateName: template.name,
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
  params: { organizationId: string; messageId: string; sentByUserId: string; now?: Date },
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
  const { conversation, channel } = await loadConversation(provider, params.organizationId, message.conversationId, now);

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
    send: () =>
      provider.sendText({
        providerAccountId: channel.providerAccountId,
        providerConversationId: conversation.providerConversationId!,
        text: message.body!,
        idempotencyKey: message.id,
      }),
    now,
    conversation,
    organizationId: params.organizationId,
    sentByUserId: params.sentByUserId,
  });
}

// Envía (texto o plantilla, vía la closure `send`) y clasifica el resultado
// igual para ambos: enviado → enlaza el wamid; rechazado (4xx) → "failed" con su
// código; desconocido (timeout/5xx/2xx sin id) → queda "queued" y se reconcilia.
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
  },
): Promise<SendOutcome> {
  const where = and(eq(messages.id, ctx.messageId), eq(messages.organizationId, ctx.organizationId));
  // Corte de lectura: el último entrante que el vendedor tenía a la vista al
  // enviar. Lo que entre después sigue sin leer (aunque haya otros envíos).
  const readCutoffMessageId = ctx.markRead === false ? null : await latestInboundMessageId(ctx.conversation.id);
  let result: SendResult;
  try {
    result = await ctx.send();
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
    return { messageId: ctx.messageId, status: "pending" };
  }

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
  });
  return { messageId: finalId, status: "sent" };
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

// Un envío de resultado desconocido que siguió sin confirmarse (ni por la
// respuesta ni por el eco) tras este tiempo pasa a "failed" y se puede revisar.
export const SEND_UNCONFIRMED_AFTER_MS = 15 * 60_000;

/**
 * Barrido del worker: envíos del CRM que siguen "queued" sin wamid tras
 * SEND_UNCONFIRMED_AFTER_MS desde su último intento (resultado desconocido, o
 * el proceso murió tras el POST) pasan a "failed" con error_code
 * send_unconfirmed.
 *
 * NO se intenta adivinar cuál saliente del proveedor es: Zernio no acepta un
 * id de correlación propio, y emparejar por texto y hora podría atribuirle al
 * vendedor un mensaje ajeno. Si el envío sí salió, su eco ya está en el hilo
 * (el vendedor lo ve). No se ofrece "Reintentar" para un envío sin confirmar:
 * Zernio libera la clave al fallar, así que reintentar podría duplicar; el
 * vendedor revisa el chat y, si no llegó, lo escribe de nuevo.
 */
export async function expireUnconfirmedSends(now = new Date()): Promise<number> {
  const expired = await db
    .update(messages)
    .set({
      status: "failed",
      errorCode: SEND_UNCONFIRMED,
      errorMessage: "WhatsApp no confirmó el envío. Revisa el chat antes de reintentar.",
    })
    .where(
      and(
        eq(messages.direction, "out"),
        inArray(messages.source, ["crm", "ai_agent"]),
        eq(messages.status, "queued"),
        isNull(messages.providerMessageId),
        // sent_at = último intento (un reintento lo renueva), no la creación.
        lt(messages.sentAt, new Date(now.getTime() - SEND_UNCONFIRMED_AFTER_MS)),
      ),
    )
    .returning({ id: messages.id });
  return expired.length;
}
