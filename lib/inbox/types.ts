// Contrato de datos backend → UI de la bandeja (docs/bandeja.md). Solo
// tipos: la UI (Client Components) puede importarlo sin arrastrar el servidor.
import type { NormalizedMessageType } from "@/lib/messaging/provider";

import type { TemperatureFilter } from "@/lib/contacts/filters";

/** Pestañas de la lista. "starred" = Destacado: la marca ⭐ del contacto (0048). */
export type InboxFilter = "unread" | "all" | "starred";

/** Parámetros de la lista: pestaña, temperatura (una a la vez; se suma a la pestaña) y búsqueda. */
export type InboxListParams = { filter?: InboxFilter; temperature?: TemperatureFilter | null; search?: string };

// "system_note" (Fase D): aviso interno para el vendedor (p. ej. "cotejar
// depósito"); vive en el hilo, nunca se manda por WhatsApp.
export type MessageKind = NormalizedMessageType | "system_note";

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
  /** Destacado ⭐ del CONTACTO (contacts.destacado, 0048): la estrella de la fila. */
  isStarred: boolean;
  /** Temperatura del CONTACTO (🔥🧊⏳), editable desde la lista (C1). */
  temperature: string | null;
  /**
   * Semáforo: desde cuándo espera respuesta el cliente (su mensaje más viejo
   * sin contestar después de la última respuesta humana que sí salió). null =
   * nada pendiente, sin punto.
   */
  awaitingReplySince: Date | null;
  /** Fin de la ventana de 24 h (null = nunca escribió el cliente). */
  windowExpiresAt: Date | null;
  /** El canal de la conversación es de PRUEBA (etiqueta "Prueba"). */
  isTestChannel: boolean;
};

export type ConversationPage = { items: ConversationListItem[]; nextCursor: string | null };

/**
 * Tarjeta compacta "📣 Llegó por anuncio" (1–2 líneas, toda clicable): solo
 * lo que se muestra, NUNCA la ficha completa ni ids de rastreo.
 */
export type AdReferral = {
  /** Nombre del anuncio en Meta; si aún no se consultó, el titular de la ficha. */
  name: string;
  /** Página del anuncio en el CRM (/anuncios/{id}). */
  href: string;
  /** Miniatura desde el bucket propio (/api/ads/media/…); null mientras se copia. */
  thumbnailUrl: string | null;
  mediaType: string | null;
};

export type ConversationDetail = {
  id: string;
  contact: InboxContact & { stage: string; temperature: string | null };
  windowExpiresAt: Date | null;
  isStarred: boolean;
  unreadCount: number;
  /**
   * Entrada por anuncio (ventana GRATIS de 72 h de Meta: la abre la primera
   * respuesta del negocio dentro de 24 h). null = no llegó por anuncio.
   */
  adEntry: { entryAt: Date; firstReplyAt: Date | null } | null;
  /** Canal de la conversación: de prueba (etiqueta) y archivado (sin envíos). */
  channel: { isTest: boolean; archived: boolean };
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
  /** Misma ruta con ?download=1: fuerza "Guardar como". */
  downloadUrl: string;
  /** Miniatura de la 1ª página (PDF), cuando ya se generó. */
  thumbnailUrl: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
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
  /** Copiado del historial del celular (coexistencia): marca "Importado del celular". */
  importedFromPhone: boolean;
  /**
   * Nota de voz del cliente (Agente IA parte 1): "lista" con el texto, "pendiente"
   * mientras se transcribe, "sin" con el motivo (dura más de 10 min, falló…). null =
   * no aplica (no es audio del cliente o es historial viejo sin intento).
   */
  transcription: { state: "lista"; text: string } | { state: "pendiente" } | { state: "sin"; reason: string } | null;
  /**
   * Primer mensaje que WhatsApp no pasó al CRM (Meta 131060, caso SDA): "verificando"
   * los primeros segundos, "sin_contenido" si se confirmó. `body` ya trae el texto de
   * la tarjeta. null = mensaje normal.
   */
  noDisponible: "verificando" | "sin_contenido" | null;
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
  | "template_params"
  | "media_not_found"
  | "storage_unavailable"
  | "no_phone"
  | "duplicate_phone";

/** pending = resultado desconocido: el mensaje queda "enviando" mientras se verifica. */
export type SendMessageResult =
  | { ok: true; messageId: string; pending: boolean }
  | { ok: false; code: SendErrorCode; message: string };

/** Qué cambió de un contacto (evento `contact.updated`). */
export type ContactChange = "etapa" | "temperatura" | "cotizacion" | "detalle" | "comentarios";

/**
 * Quién hizo el cambio. `userId` en automatización = el vendedor que la disparó
 * con un comando (p. ej. /banco); sin él, la disparó el cliente (palabra clave).
 */
export type ContactChangeActor =
  // `role`: su rol en la organización (member.role: owner | admin | agent), para el
  // emoji del aviso en el celular (🌎 owner/admin, 👨🏽‍💻 vendedor). Falta si no se supo.
  | { kind: "vendedor"; userId: string; name: string; role?: string }
  | { kind: "agente" }
  | { kind: "automatizacion"; userId: string | null };

/** Un contacto cambió (etapa, temperatura, cotización o campos del Detalle). */
/**
 * Indicador del Detalle (29-sep-2026): el lector en segundo plano avisa cuando EMPIEZA a leer
 * el chat de un contacto ("leyendo") y cuando termina ("listo", con cuántos datos cambió, o
 * "error"). Solo informa: el Detalle en sí se actualiza con contact.updated.
 */
export type LectorStatusEvent = {
  type: "lector.status";
  contactId: string;
  conversationId: string;
  phase: "leyendo" | "listo" | "error";
  /** Cuántos datos cambió (solo en "listo"). */
  cambios: number;
};

export type ContactUpdatedEvent = {
  type: "contact.updated";
  contactId: string;
  /** Nombre como lo muestra el CRM (para el aviso emergente). */
  contactName: string;
  changes: ContactChange[];
  /** Solo si cambió la etapa. */
  stage?: { from: string; to: string };
  by: ContactChangeActor;
  /** Hora del cambio (ISO, UTC). */
  at: string;
};

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
  /** Muchos contactos nuevos en una sola sentencia (importación): el kanban se recarga una vez. */
  | { type: "contacts.bulk" }
  /**
   * Un lote del historial del celular (importador: cada 500 mensajes o 5 s). La Bandeja
   * relee su lista una vez; el Embudo sus señales y, si nacieron contactos, el tablero.
   */
  | { type: "inbox.bulk"; contactos: number }
  /** Un contacto cambió: la UI vuelve a pedir ese contacto (lib/contacts/notify-updated.ts). */
  | ContactUpdatedEvent
  /** El Agente IA empezó o terminó de leer en segundo plano el chat de un contacto (lector.ts). */
  | LectorStatusEvent
  /** Las etapas del Embudo cambiaron (editor): la UI vuelve a pedir la lista. Al borrar una, cuántos contactos pasaron de `from` a `to`. */
  | StagesUpdatedEvent
  | { type: "reload" };

export type StagesUpdatedEvent = {
  type: "stages.updated";
  reason: "created" | "updated" | "reordered" | "role" | "deleted";
  movedContacts: number;
  from: string | null;
  to: string | null;
};
