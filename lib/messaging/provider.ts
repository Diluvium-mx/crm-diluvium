// Contrato entre el CRM y el proveedor de WhatsApp. Hoy: Zernio (coexistencia).
// Mañana, si se migra a la Cloud API directa de Meta, se agrega otro adaptador
// que cumpla esta interfaz y el resto del CRM (webhook, worker, envío) no cambia.
//
// Los eventos se normalizan a este formato antes de tocar la base: el worker
// nunca lee el payload crudo del proveedor.

export type ProviderName = "zernio" | "meta_cloud";

export type NormalizedMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "template"
  | "interactive"
  | "unknown";

export type NormalizedAttachment = {
  type: NormalizedMessageType;
  url: string;
  mimeType?: string;
  fileName?: string;
  /** Id de la media en WhatsApp/Meta (estable entre proveedores). */
  providerMediaId?: string;
  /** sha256 del archivo (base64) según WhatsApp: verifica la descarga. */
  sha256?: string;
};

// Mensaje entrante del contacto, o eco de uno saliente (enviado desde el CRM,
// desde la app de WhatsApp Business del celular en coexistencia, u otra API).
export type NormalizedMessageEvent = {
  kind: "message";
  eventId: string;
  providerAccountId: string;
  providerConversationId: string;
  direction: "in" | "out";
  source: "contact" | "crm" | "business_app" | "other_api";
  // wamid de WhatsApp: estable entre proveedores.
  providerMessageId: string;
  providerInternalId: string;
  // Teléfono del contacto (no del negocio), sin normalizar.
  contactPhone: string;
  contactName?: string;
  type: NormalizedMessageType;
  body: string | null;
  attachments: NormalizedAttachment[];
  sentAt: Date;
  // Atribución de anuncio Click-to-WhatsApp, cuando la conversación vino de uno.
  referral?: Record<string, unknown>;
};

export type NormalizedStatusEvent = {
  kind: "status";
  eventId: string;
  /** Cuenta del proveedor (número conectado): acota el estado a SU organización. */
  providerAccountId?: string;
  status: "sent" | "delivered" | "read" | "failed";
  providerMessageId?: string;
  providerInternalId?: string;
  errorCode?: string;
  errorMessage?: string;
  at: Date;
};

// Evento válido y firmado que el CRM no procesa (todavía) o cuyo formato no
// se reconoce. Queda guardado en webhook_events para reprocesarlo después.
export type NormalizedIgnoredEvent = {
  kind: "ignored";
  eventId: string;
  event: string;
  reason: string;
};

export type NormalizedEvent = NormalizedMessageEvent | NormalizedStatusEvent | NormalizedIgnoredEvent;

export type WebhookEnvelope = {
  /** Id único del evento en el proveedor: clave de idempotencia. */
  eventId: string;
  event: string;
  /** Cuenta (número conectado) a la que pertenece el evento, si viene. */
  providerAccountId?: string;
};

export type SendTextInput = {
  providerAccountId: string;
  providerConversationId: string;
  text: string;
  /**
   * Clave de idempotencia (el id de NUESTRO mensaje): reintentar con la misma
   * clave no vuelve a enviar si el primer intento sí llegó al proveedor.
   */
  idempotencyKey: string;
};

/**
 * Fallo al enviar. `outcome` distingue lo que importa para no duplicar:
 * - "rejected": el proveedor contestó que NO lo envió (4xx, límite de tasa):
 *   se puede reintentar sin riesgo;
 * - "unknown": no se sabe si salió (timeout, corte, 5xx, respuesta ilegible):
 *   hay que reconciliar contra el proveedor ANTES de permitir reintentar.
 */
export class SendFailedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: "rejected" | "unknown",
  ) {
    super(message);
    this.name = "SendFailedError";
  }
}

/** Saliente visto en el proveedor (para reconciliar envíos de resultado desconocido). */
export type ProviderOutgoingMessage = {
  providerMessageId: string;
  text: string | null;
  at: Date;
  status?: "sent" | "delivered" | "read" | "failed";
};

export type SendResult = {
  providerInternalId: string;
  providerMessageId?: string;
};

export interface MessagingProvider {
  readonly name: ProviderName;
  /** Valida la firma del webhook sobre el body CRUDO (antes de parsear). */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Lee lo mínimo del sobre para deduplicar y guardar. Lanza si no es JSON válido. */
  readEnvelope(rawBody: string): WebhookEnvelope;
  /** Normaliza un payload ya verificado. Nunca lanza por formatos desconocidos: devuelve "ignored". */
  normalize(payload: unknown): NormalizedEvent;
  /** Lanza SendFailedError (rechazado o desconocido) si no hay confirmación. */
  sendText(input: SendTextInput): Promise<SendResult>;
  /** Últimos salientes de una conversación en el proveedor, del más nuevo al más viejo. */
  listRecentOutgoing(input: { providerAccountId: string; providerConversationId: string }): Promise<ProviderOutgoingMessage[]>;
  /**
   * Descarga un adjunto recibido. El adaptador decide si la URL necesita sus
   * credenciales, y NUNCA las envía a un dominio que no sea el suyo.
   */
  fetchMedia(url: string, signal?: AbortSignal): Promise<Response>;
}
