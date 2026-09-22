// Contrato de datos backend → UI de la bandeja (docs/bandeja.md). Solo
// tipos: la UI (Client Components) puede importarlo sin arrastrar el servidor.
import type { NormalizedMessageType } from "@/lib/messaging/provider";

export type InboxFilter = "unread" | "all" | "starred";

export type MessageKind = NormalizedMessageType;

export type InboxContact = {
  id: string;
  /** Nombre completo para mostrar. */
  name: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  /** Misma regla que contact-avatar: primera letra de nombre y apellido; null → ícono de persona. */
  avatarInitials: string | null;
  /** Canal de origen (badge del avatar), p. ej. "whatsapp". */
  sourceChannel: string | null;
};

export type ConversationListItem = {
  id: string;
  contact: InboxContact;
  /**
   * Último mensaje del hilo. `preview` es el texto de una línea SIN el
   * prefijo "Tú:" (la UI lo agrega si direction === "out"); un adjunto sin
   * texto viene como "📎 Foto", "📄 Documento", "🎤 Audio", "🎬 Video"…
   */
  lastMessage: { preview: string; direction: "in" | "out"; kind: MessageKind; at: Date } | null;
  unreadCount: number;
  isStarred: boolean;
  /**
   * Semáforo: desde cuándo espera respuesta el cliente (su mensaje más viejo
   * sin contestar después de la última respuesta humana que sí salió). null =
   * nada pendiente, sin punto.
   */
  awaitingReplySince: Date | null;
  /** Fin de la ventana de 24 h (null = nunca escribió el cliente). */
  windowExpiresAt: Date | null;
};

export type ConversationPage = { items: ConversationListItem[]; nextCursor: string | null };

/** Tarjeta "📣 Llegó por anuncio": solo lo que se muestra, NUNCA el volcado crudo. */
export type AdReferral = {
  headline: string | null;
  body: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  mediaType: string | null;
};

export type ConversationDetail = {
  id: string;
  contact: InboxContact & { stage: string; temperature: string | null };
  windowExpiresAt: Date | null;
  isStarred: boolean;
  unreadCount: number;
  adReferral: AdReferral | null;
};

export type AttachmentView = {
  index: number;
  kind: MessageKind;
  fileName: string | null;
  mimeType: string | null;
  /** processing = aún se copia al bucket ("procesando…"); failed = se agotaron los intentos. */
  state: "ready" | "processing" | "failed";
  /** /api/media/{messageId}/{index} (exige sesión; 202 mientras procesa). */
  url: string;
};

export type MessageView = {
  id: string;
  direction: "in" | "out";
  kind: MessageKind;
  body: string | null;
  attachments: AttachmentView[];
  /**
   * queued = enviando, o verificando un envío de resultado desconocido (sin
   * botón de reintentar). ✓ sent · ✓✓ delivered · ✓✓ azul read · ⚠ failed.
   */
  status: "queued" | "sent" | "delivered" | "read" | "failed" | "received";
  errorMessage: string | null;
  /** true solo si "Reintentar" es seguro (no duplica al cliente). */
  canRetry: boolean;
  sentAt: Date;
  adReferral: AdReferral | null;
  /** Reacción vigente de cada lado (WhatsApp: una por persona). */
  reactions: { contact?: string; business?: string };
  editedAt: Date | null;
  /** Su autor lo borró en WhatsApp; el contenido se conserva en el CRM. */
  deletedAt: Date | null;
  location: { latitude: number; longitude: number; name: string | null; address: string | null } | null;
  /** Nombres de las tarjetas de contacto compartidas. */
  contactCards: string[];
  /** Mensaje citado (respuesta a otro), si está en el CRM. */
  quoted: { direction: "in" | "out"; preview: string } | null;
};

/** Página de mensajes en orden cronológico (viejo → nuevo); `hasMore` = hay más viejos. */
export type MessagePage = { messages: MessageView[]; hasMore: boolean };

export type SendErrorCode =
  | "empty"
  | "window_closed"
  | "not_found"
  | "not_linked"
  | "not_retryable"
  | "channel_unavailable"
  | "provider_rejected"
  | "not_configured"
  | "template_not_found"
  | "template_not_approved"
  | "template_unsupported"
  | "template_params";

/** pending = resultado desconocido: el mensaje queda "enviando" mientras se verifica. */
export type SendMessageResult =
  | { ok: true; messageId: string; pending: boolean }
  | { ok: false; code: SendErrorCode; message: string };

/**
 * Eventos del SSE /api/inbox/stream. La UI vuelve a pedir la fila o el mensaje.
 * `reload` (al conectar y tras una reconexión de la escucha) = revalida todo,
 * porque pudieron perderse eventos mientras la escucha estuvo caída.
 */
export type InboxEvent =
  | { type: "conversation.updated"; conversationId: string }
  | { type: "message.upserted"; conversationId: string; messageId: string }
  | { type: "message.deleted"; conversationId: string; messageId: string }
  /** Contacto nuevo (p. ej. primer mensaje de un número desconocido): el kanban lo agrega. */
  | { type: "contact.created"; contactId: string }
  | { type: "reload" };
