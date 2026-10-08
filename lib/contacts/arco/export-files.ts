// Qué archivos van en `archivos/` del zip de un contacto (ARCO, 7-oct-2026). PURO.
// SOLO lo que mandó el CLIENTE (mensajes entrantes) y ya está en el bucket; lo que mandó Diluvium
// (tablas, videos, datos bancarios, adjuntos del vendedor) no es dato del cliente y no va.
import { mazatlanMinute, safeName, kindLabel } from "./format";
import { isOwnMessageKey } from "./keys";

/** Tope del zip con archivos: arriba de esto se ofrece descargar sin archivos. */
export const EXPORT_MAX_FILE_BYTES = 200 * 1024 * 1024;

export type ExportAttachment = {
  type: string;
  fileName?: string;
  mimeType?: string;
  storageKey?: string;
  sizeBytes?: number;
};

export type ExportFileSource = {
  id: string;
  direction: string;
  at: Date;
  attachments: readonly ExportAttachment[];
};

export type ExportFile = {
  messageId: string;
  /** Posición del adjunto dentro de su mensaje. */
  index: number;
  key: string;
  /** Ruta dentro del zip: "archivos/2026-10-03_1012_1-foto.jpg". */
  zipPath: string;
  bytes: number;
};

const EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
};

function baseName(a: ExportAttachment): string {
  if (a.fileName) return safeName(a.fileName, kindLabel(a.type));
  const mime = (a.mimeType ?? "").toLowerCase().split(";")[0].trim();
  return `${safeName(kindLabel(a.type), "archivo")}${EXTENSION[mime] ?? ""}`;
}

/**
 * Archivos del cliente, en el orden del chat, cada uno con un nombre único en el zip
 * (fecha y hora de Mazatlán + número corrido + nombre seguro).
 */
export function clientFiles(organizationId: string, messages: readonly ExportFileSource[]): ExportFile[] {
  const out: ExportFile[] = [];
  for (const m of messages) {
    if (m.direction !== "in") continue;
    m.attachments.forEach((a, index) => {
      if (!a.storageKey || !isOwnMessageKey(organizationId, a.storageKey)) return;
      const stamp = mazatlanMinute(m.at).replace(" ", "_").replace(":", "");
      out.push({
        messageId: m.id,
        index,
        key: a.storageKey,
        zipPath: `archivos/${stamp}_${out.length + 1}-${baseName(a)}`,
        bytes: Math.max(0, a.sizeBytes ?? 0),
      });
    });
  }
  return out;
}

export function totalBytes(files: readonly ExportFile[]): number {
  return files.reduce((sum, f) => sum + f.bytes, 0);
}

/** "312 MB" (redondeado hacia arriba, mínimo 1 MB si hay algo). */
export function megabytes(bytes: number): string {
  return `${bytes > 0 ? Math.max(1, Math.ceil(bytes / (1024 * 1024))) : 0} MB`;
}
