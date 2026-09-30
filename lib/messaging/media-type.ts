// Tipo VERIFICADO de un adjunto de mensaje (S2, revisión de seguridad CN-005,
// 30-sep-2026). El tipo que declara WhatsApp lo decide el celular del cliente:
// un "cotizacion.pdf" podía llegar como text/html y abrirse con su código dentro
// del visor del CRM. Ahora el worker lee los primeros bytes al descargar y solo
// se MUESTRA en el CRM lo que de verdad es imagen, audio, video o PDF, y además
// coincide con lo que dice ser; todo lo demás queda como descarga
// (application/octet-stream). Puro: lo usan el worker, la ruta /api/media, la
// bandeja y el script que revisa los adjuntos anteriores.
import { detectMagic, type MagicType } from "@/lib/chat-attachments/sniff";

/** Tipo de "archivo para descargar": nunca se muestra dentro del CRM. */
export const OCTET = "application/octet-stream";

/** Bytes que se leen para decidir (el PDF tolera basura en su primer KB). */
export const MEDIA_SNIFF_BYTES = 4 * 1024;

export type MediaPreview = "image" | "audio" | "video" | "pdf";

// Por tipo de mensaje, los formatos que se muestran y con qué Content-Type se sirven.
const SHOWN: Record<MediaPreview, Partial<Record<MagicType, string>>> = {
  image: { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" },
  audio: { ogg: "audio/ogg", mp3: "audio/mpeg", aac: "audio/aac", amr: "audio/amr", m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm" },
  video: { mp4: "video/mp4", "3gp": "video/3gpp", webm: "video/webm" },
  pdf: { pdf: "application/pdf" },
};

const MIME_TO_PREVIEW = new Map<string, MediaPreview>(
  (Object.entries(SHOWN) as [MediaPreview, Partial<Record<MagicType, string>>][]).flatMap(([preview, byMagic]) =>
    Object.values(byMagic).map((mime) => [mime, preview] as [string, MediaPreview]),
  ),
);

// Tipo de mensaje de WhatsApp → qué vista le corresponde (un documento solo se muestra si es PDF).
function previewForKind(kind: string): MediaPreview {
  if (kind === "image" || kind === "sticker") return "image";
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  return "pdf";
}

/**
 * Content-Type verificado de un adjunto por sus primeros bytes y su tipo de
 * mensaje. Una foto que en realidad es PDF, o un PDF que en realidad es HTML,
 * quedan como OCTET (solo descarga).
 */
export function verifiedMediaMime(head: Uint8Array, kind: string): string {
  const magic = detectMagic(head);
  if (!magic) return OCTET;
  return SHOWN[previewForKind(kind)][magic] ?? OCTET;
}

/**
 * Archivos que salen DEL CRM (adjunto del chat, ya revisado por bytes al
 * subirlo, o archivo de la Biblioteca): su MIME ya es de confianza; solo se
 * comprueba que sea uno de los que se muestran para ese tipo de mensaje.
 */
export function trustedMediaMime(kind: string, mime: string): string {
  const clean = mime.toLowerCase().split(";")[0].trim();
  return MIME_TO_PREVIEW.get(clean) === previewForKind(kind) ? clean : OCTET;
}

/** Cómo se muestra en el CRM (null = solo descarga, o aún sin revisar). */
export function previewOf(verifiedMime: string | undefined | null): MediaPreview | null {
  return verifiedMime ? (MIME_TO_PREVIEW.get(verifiedMime) ?? null) : null;
}
