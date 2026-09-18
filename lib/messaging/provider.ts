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
};

export type SendTextInput = {
  providerAccountId: string;
  providerConversationId: string;
  text: string;
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
  sendText(input: SendTextInput): Promise<SendResult>;
}
