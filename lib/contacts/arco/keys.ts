// Qué archivos del bucket son DEL contacto al borrarlo (derechos ARCO, 7-oct-2026). PURO.
//
// Solo los propios de sus mensajes, con sus miniaturas:
// - lo recibido en su chat (org/{org}/messages/{mensaje}/…, lib/messaging/media-keys.ts), y
// - lo que un vendedor adjuntó en su chat (org/{org}/chat/{día}/…, lib/chat-attachments/keys.ts).
// NUNCA la Biblioteca de medios (org/{org}/library/…, lib/media-library/rules.ts): sus archivos
// los comparten todos los chats (Multimedia y los workflows mandan el MISMO archivo una y otra
// vez), así que un mensaje que lo usa no es dueño de él. Tampoco las miniaturas de anuncios.

/** ¿La llave es un archivo propio de los mensajes de ESTA organización (recibido o adjunto del chat)? */
export function isOwnMessageKey(organizationId: string, key: string): boolean {
  if (!key || key.includes("..")) return false;
  return key.startsWith(`org/${organizationId}/messages/`) || key.startsWith(`org/${organizationId}/chat/`);
}

/** Carpeta de los archivos de UN mensaje recibido (para lo que se descargó sin anotarse todavía). */
export function messageFolderPrefix(organizationId: string, messageId: string): string {
  return `org/${organizationId}/messages/${messageId}/`;
}

type StoredParts = { storageKey?: string; thumbnailKey?: string; providerMediaId?: string; url?: string };

/** Originales propios de una lista de adjuntos (sin miniaturas): lo que el vendedor cuenta como «archivos». */
export function ownOriginalKeys(organizationId: string, attachments: readonly StoredParts[]): string[] {
  const keys = new Set<string>();
  for (const a of attachments) if (a.storageKey && isOwnMessageKey(organizationId, a.storageKey)) keys.add(a.storageKey);
  return [...keys];
}

/** Todo lo que se borra del bucket por esos adjuntos: originales propios y sus miniaturas. */
export function ownKeysToDelete(organizationId: string, attachments: readonly StoredParts[]): string[] {
  const keys = new Set<string>();
  for (const a of attachments) {
    if (a.storageKey && isOwnMessageKey(organizationId, a.storageKey)) keys.add(a.storageKey);
    if (a.thumbnailKey && isOwnMessageKey(organizationId, a.thumbnailKey)) keys.add(a.thumbnailKey);
  }
  return [...keys];
}

/**
 * ¿Algún adjunto con archivo aún no tiene su copia anotada (descarga pendiente o en curso)? Su
 * carpeta se lista al borrar: la descarga pudo subirlo al bucket justo antes de anotarlo.
 */
export function hasUnstoredAttachment(attachments: readonly StoredParts[]): boolean {
  return attachments.some((a) => !a.storageKey && Boolean(a.providerMediaId || a.url));
}
