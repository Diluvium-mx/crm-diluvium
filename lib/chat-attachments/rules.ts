// Adjuntos del chat (28-sep-2026): qué archivos puede mandar el vendedor desde
// la Bandeja y el pop-up del Embudo, con qué límites (los de WhatsApp,
// lib/media-library/rules.ts) y qué pasa con cada uno. Puro: lo usan el
// navegador (aviso inmediato) y el servidor (vuelve a validar al subir).

import { MEDIA_LIMITS, type MediaKind } from "@/lib/media-library/rules";

/**
 * XML (facturas CFDI): WhatsApp no acepta application/xml como documento, así
 * que se manda como documento de TEXTO (text/plain) con su nombre original
 * terminado en .xml. Si la prueba real falla, esta línea a `false` lo quita en
 * todo el CRM (selector, capa, aviso y servidor).
 */
export const XML_COMO_TEXTO = true;

export const CHAT_MAX_FILES = 10;
/** Tope de WhatsApp para el pie de un archivo. */
export const CHAT_CAPTION_MAX = 1_024;

export type ChatFileKind = MediaKind;

type Accepted = { kind: ChatFileKind; mime: string };

const DOCS: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

// Fotos que el navegador convierte a JPG antes de subir (WhatsApp solo acepta JPG/PNG).
const CONVERTIBLE_IMAGES = new Set(["heic", "heif", "webp"]);

/** Extensión en minúsculas sin el punto ("" si no tiene). */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** Tipo y MIME con el que se manda un archivo YA listo (la foto convertida ya es .jpg). null = no se acepta. */
export function acceptedType(fileName: string): Accepted | null {
  const ext = extensionOf(fileName);
  if (ext === "jpg" || ext === "jpeg") return { kind: "image", mime: "image/jpeg" };
  if (ext === "png") return { kind: "image", mime: "image/png" };
  if (ext === "mp4") return { kind: "video", mime: "video/mp4" };
  if (ext === "xml") return XML_COMO_TEXTO ? { kind: "document", mime: "text/plain" } : null;
  const doc = DOCS[ext];
  return doc ? { kind: "document", mime: doc } : null;
}

export function maxBytesFor(kind: ChatFileKind): number {
  return MEDIA_LIMITS[kind].maxBytes;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function notAcceptedMessage(fileName: string): string {
  const ext = extensionOf(fileName);
  return `WhatsApp no acepta este archivo desde el CRM (${ext ? `.${ext}` : "sin extensión"}). Mándalo desde el celular o WhatsApp Web.`;
}

export type FilePlan =
  | { ok: true; action: "upload"; kind: ChatFileKind; mime: string }
  /** Foto HEIC/WebP, o JPG/PNG de más de 5 MB: el navegador la pasa a JPG y la reduce antes de subir. */
  | { ok: true; action: "convert"; kind: "image"; mime: "image/jpeg" }
  | { ok: false; message: string };

/** Qué hacer con un archivo que el vendedor soltó, pegó o eligió. */
export function planFile(file: { name: string; size: number }): FilePlan {
  if (file.size <= 0) return { ok: false, message: `"${file.name}" está vacío.` };
  const ext = extensionOf(file.name);
  if (CONVERTIBLE_IMAGES.has(ext)) return { ok: true, action: "convert", kind: "image", mime: "image/jpeg" };
  const type = acceptedType(file.name);
  if (!type) return { ok: false, message: notAcceptedMessage(file.name) };
  if (type.kind === "image" && file.size > maxBytesFor("image")) return { ok: true, action: "convert", kind: "image", mime: "image/jpeg" };
  if (file.size > maxBytesFor(type.kind)) {
    const what = type.kind === "video" ? "videos .mp4" : "documentos";
    return {
      ok: false,
      message: `"${file.name}" pesa ${formatBytes(file.size)}; WhatsApp acepta ${what} de hasta ${formatBytes(maxBytesFor(type.kind))}.`,
    };
  }
  return { ok: true, action: "upload", kind: type.kind, mime: type.mime };
}

/** Texto de ayuda de la capa y del selector (sale de las mismas reglas: XML incluido solo si se acepta). */
export function attachmentHelpText(): string {
  const docs = `.pdf, Word, Excel, PowerPoint, .txt${XML_COMO_TEXTO ? ", .xml" : ""}`;
  return `Fotos (.jpg, .jpeg, .png, .heic), videos .mp4 de hasta 16 MB y documentos (${docs}) de hasta 100 MB. Máximo ${CHAT_MAX_FILES} archivos.`;
}

/** `accept` del selector de archivos. */
export function attachmentAcceptAttr(): string {
  const exts = ["jpg", "jpeg", "png", "heic", "heif", "webp", "mp4", ...Object.keys(DOCS), ...(XML_COMO_TEXTO ? ["xml"] : [])];
  return exts.map((e) => `.${e}`).join(",");
}

/**
 * Cómo salen los archivos al enviar: uno por mensaje de WhatsApp, en el orden
 * en que se ven; el texto del vendedor va como pie del PRIMERO (sin texto,
 * solo los archivos).
 */
export class ChatSendPlanError extends Error {}

export function planSend<T>(files: readonly T[], caption: string): { file: T; caption: string | null }[] {
  if (files.length === 0) throw new ChatSendPlanError("Adjunta al menos un archivo.");
  if (files.length > CHAT_MAX_FILES) throw new ChatSendPlanError(`Máximo ${CHAT_MAX_FILES} archivos por envío.`);
  const text = caption.trim();
  if (text.length > CHAT_CAPTION_MAX) throw new ChatSendPlanError(`El texto pasa de ${CHAT_CAPTION_MAX.toLocaleString("es-MX")} caracteres.`);
  return files.map((file, i) => ({ file, caption: i === 0 && text ? text : null }));
}

/** Nombre del archivo ya convertido a JPG ("IMG_1234.HEIC" → "IMG_1234.jpg"). */
export function jpgName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return `${dot > 0 ? fileName.slice(0, dot) : fileName || "foto"}.jpg`;
}
