// Tipo REAL de un adjunto del chat por sus primeros bytes (28-sep-2026): el
// servidor no se fía de la extensión ni del Content-Type que manda el
// navegador. Puro (Uint8Array), para testearlo solo.
import { acceptedType, extensionOf, notAcceptedMessage, type ChatFileKind } from "./rules";

/** Bytes que se leen antes de decidir (Office guarda "[Content_Types].xml" al principio). */
export const SNIFF_BYTES = 64 * 1024;

export type SniffResult = { ok: true; kind: ChatFileKind; mime: string } | { ok: false; message: string };

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
const startsWith = (bytes: Uint8Array, sig: readonly number[]) => sig.every((b, i) => bytes[i] === b);

function includesAscii(bytes: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

// Texto plano: sin bytes NUL (un binario con extensión .txt/.xml no pasa).
function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.includes(0);
}

// XML: tras un BOM y espacios opcionales, empieza con "<".
function looksLikeXml(bytes: Uint8Array): boolean {
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x3c && looksLikeText(bytes);
}

// MP4: caja "ftyp" con una marca de video MP4. HEIC/AVIF (fotos) y QuickTime (.mov) no.
const NOT_MP4_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis", "qt  "]);
function isMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== "ftyp") return false;
  return !NOT_MP4_BRANDS.has(ascii(bytes, 8, 12).toLowerCase());
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const; // .doc/.xls/.ppt
const ZIP = [0x50, 0x4b, 0x03, 0x04] as const; // .docx/.xlsx/.pptx (y .zip)

/**
 * Confirma que los primeros bytes corresponden a la extensión. Devuelve el tipo
 * y MIME con el que se guarda y se manda (XML → text/plain).
 */
export function sniffChatFile(head: Uint8Array, fileName: string): SniffResult {
  const type = acceptedType(fileName);
  if (!type) return { ok: false, message: notAcceptedMessage(fileName) };
  const ext = extensionOf(fileName);
  const mismatch: SniffResult = { ok: false, message: `"${fileName}" no es un archivo .${ext} válido (su contenido no coincide con la extensión).` };
  if (head.length === 0) return { ok: false, message: `"${fileName}" está vacío.` };
  let ok: boolean;
  switch (ext) {
    case "jpg":
    case "jpeg":
      ok = startsWith(head, [0xff, 0xd8, 0xff]);
      break;
    case "png":
      ok = startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      break;
    case "mp4":
      ok = isMp4(head);
      break;
    case "pdf":
      // La especificación tolera basura antes de "%PDF-" en el primer KB.
      ok = includesAscii(head.subarray(0, 1024), "%PDF-");
      break;
    case "doc":
    case "xls":
    case "ppt":
      ok = startsWith(head, OLE);
      break;
    case "docx":
    case "xlsx":
    case "pptx":
      ok = startsWith(head, ZIP) && includesAscii(head, "[Content_Types].xml");
      break;
    case "xml":
      ok = looksLikeXml(head);
      break;
    case "txt":
      ok = looksLikeText(head);
      break;
    default:
      ok = false;
  }
  return ok ? { ok: true, kind: type.kind, mime: type.mime } : mismatch;
}

/**
 * Formato real de un archivo por sus primeros bytes, SIN mirar nombre ni tipo
 * declarado (S2, 30-sep-2026): lo usan la media que llega de WhatsApp (el tipo
 * lo declara el celular del cliente) y la Biblioteca (lo declara el navegador).
 * null = no es ningún formato conocido.
 */
export type MagicType =
  | "jpeg" | "png" | "gif" | "webp" | "pdf"
  | "mp4" | "m4a" | "3gp" | "quicktime" | "heif" | "webm"
  | "ogg" | "mp3" | "aac" | "amr"
  | "ole" | "ooxml" | "zip";

const M4A_BRANDS = new Set(["m4a ", "m4b ", "m4p "]);

export function detectMagic(head: Uint8Array): MagicType | null {
  if (head.length === 0) return null;
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return "gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "webp";
  if (includesAscii(head.subarray(0, 1024), "%PDF-")) return "pdf";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12).toLowerCase();
    if (M4A_BRANDS.has(brand)) return "m4a";
    if (brand.startsWith("3gp") || brand.startsWith("3g2")) return "3gp";
    if (brand === "qt  ") return "quicktime";
    if (NOT_MP4_BRANDS.has(brand)) return "heif";
    return "mp4";
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (head.length >= 4 && ascii(head, 0, 4) === "OggS") return "ogg";
  if (head.length >= 5 && ascii(head, 0, 5) === "#!AMR") return "amr";
  if (head.length >= 3 && ascii(head, 0, 3) === "ID3") return "mp3";
  // Sincronía de trama MPEG: capa 00 = AAC (ADTS); capas 01–11 = MP3.
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return "aac";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && ((head[1] >> 1) & 0x03) !== 0) return "mp3";
  if (startsWith(head, OLE)) return "ole";
  if (startsWith(head, ZIP)) return includesAscii(head, "[Content_Types].xml") ? "ooxml" : "zip";
  return null;
}

/** Texto plano (sin bytes NUL): lo que la Biblioteca acepta como .txt. */
export function looksLikePlainText(head: Uint8Array): boolean {
  return head.length > 0 && looksLikeText(head);
}

// Códecs de video que WhatsApp NO reproduce aunque el contenedor sea MP4 (mismo
// criterio que la Biblioteca, lib/media-library/service.ts): HEVC sin H.264.
export const HEVC_MARKERS = ["hvc1", "hev1"] as const;
export const H264_MARKER = "avc1";
