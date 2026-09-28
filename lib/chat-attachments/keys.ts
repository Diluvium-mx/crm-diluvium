// Dónde viven los adjuntos del chat en el bucket (28-sep-2026): su PROPIA
// carpeta por organización, separada de la Biblioteca de Automatización y de la
// media recibida: org/{org}/chat/{AAAA-MM-DD}/{id}-{nombre}. El día (UTC) al
// frente permite que la limpieza de los no enviados revise solo los últimos
// días en vez de todo el historial. Puro.
import { createHash } from "node:crypto";

export function safeFileName(fileName: string): string {
  return (
    fileName
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\.{2,}/g, ".")
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._-]+/, "")
      .slice(0, 80) || "archivo"
  );
}

export function chatUploadDayPrefix(organizationId: string, day: Date): string {
  return `org/${organizationId}/chat/${day.toISOString().slice(0, 10)}/`;
}

export function chatUploadKey(organizationId: string, uploadId: string, fileName: string, now: Date): string {
  return `${chatUploadDayPrefix(organizationId, now)}${uploadId}-${safeFileName(fileName)}`;
}

/** ¿La llave es un adjunto del chat de ESTA organización? (defensa al enviar). */
export function isChatUploadKey(organizationId: string, key: string): boolean {
  const prefix = `org/${organizationId}/chat/`;
  return key.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\/[\w-]+-[\w.-]+$/.test(key.slice(prefix.length)) && !key.includes("..");
}

/**
 * Id DETERMINISTA del mensaje de un archivo subido: el mismo archivo no se
 * puede mandar dos veces (doble clic, reintento de la acción) — la segunda
 * inserción choca con la primera y no crea otra burbuja.
 */
export function chatUploadMessageId(storageKey: string): string {
  const h = createHash("sha256").update(`chat-upload:${storageKey}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-b${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
