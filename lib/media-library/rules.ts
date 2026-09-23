// Reglas puras de la biblioteca de media (Fase D): qué archivos se aceptan,
// con qué límites (los de WhatsApp vía Zernio, docs/fase-d-diseno.md §5) y
// cómo se nombran en el bucket. Sin DB ni red, para testear solas.
import type { WorkflowStepPayload } from "@/lib/db/schema/automation";

export type MediaKind = "image" | "video" | "document";

export const MEDIA_LIMITS: Record<MediaKind, { maxBytes: number; mimeTypes: readonly string[]; label: string }> = {
  image: { maxBytes: 5 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png"], label: "JPEG o PNG, máximo 5 MB" },
  video: { maxBytes: 16 * 1024 * 1024, mimeTypes: ["video/mp4", "video/3gpp"], label: "MP4 (H.264 + AAC) o 3GPP, máximo 16 MB" },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ],
    label: "PDF, Word, Excel, PowerPoint o TXT, máximo 100 MB",
  },
};

export class MediaRejectedError extends Error {
  constructor(
    readonly code: "mime" | "size" | "empty" | "name",
    message: string,
  ) {
    super(message);
    this.name = "MediaRejectedError";
  }
}

// Tipo de media a partir del MIME declarado. null = no se acepta.
export function kindForMime(mimeType: string): MediaKind | null {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  for (const kind of ["image", "video", "document"] as const) {
    if (MEDIA_LIMITS[kind].mimeTypes.includes(mime)) return kind;
  }
  return null;
}

// Valida lo declarado ANTES de subir; el tamaño real se vuelve a comprobar al
// contar bytes durante la subida (la UI puede mentir).
export function validateUpload(input: { fileName: string; mimeType: string; bytes: number }): { kind: MediaKind; fileName: string } {
  const fileName = input.fileName.trim();
  if (!fileName || fileName.length > 150) throw new MediaRejectedError("name", "Nombre de archivo inválido.");
  const kind = kindForMime(input.mimeType);
  if (!kind) throw new MediaRejectedError("mime", `Tipo de archivo no permitido (${input.mimeType}). Imagen JPEG/PNG, video MP4 o documento PDF.`);
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) throw new MediaRejectedError("empty", "El archivo está vacío.");
  if (input.bytes > MEDIA_LIMITS[kind].maxBytes) {
    throw new MediaRejectedError("size", `El archivo pesa más de lo que WhatsApp acepta: ${MEDIA_LIMITS[kind].label}.`);
  }
  return { kind, fileName };
}

// Llave en el bucket: org/{org}/library/{assetId}-{nombre-seguro}. El id al
// frente evita choques; el nombre ayuda a reconocerlo en el bucket.
export function assetStorageKey(organizationId: string, assetId: string, fileName: string): string {
  const safe = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return `org/${organizationId}/library/${assetId}-${safe || "archivo"}`;
}

// Pasos que referencian un archivo (para impedir borrarlo mientras se use).
export function stepsUsingAsset(steps: readonly { payload: WorkflowStepPayload }[], assetId: string): number {
  return steps.filter((s) => s.payload.kind === "send_media" && s.payload.assetId === assetId).length;
}
