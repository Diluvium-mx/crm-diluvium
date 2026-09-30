// Multimedia (📎 del chat, 30-sep-2026): el vendedor manda fotos y videos de la
// Biblioteca de Automatización sin volver a subirlos. El archivo ya está en el
// bucket: sale igual que en un workflow (Zernio lo baja de ahí con una URL
// firmada), por la misma cola en orden que los adjuntos del chat.
import type { ChatUploadToSend } from "@/lib/messaging/send";
import { loadMediaAsset } from "@/lib/media-library/service";
import { isMultimedia } from "@/lib/media-library/rules";
import { multimediaMessageId } from "./keys";

export class MultimediaError extends Error {}

/**
 * Archivo de la Biblioteca listo para la cola. Solo de ESTA organización, no
 * borrado y foto o video (los documentos no salen por Multimedia).
 */
export async function multimediaToSend(organizationId: string, assetId: string, sendId: string): Promise<ChatUploadToSend> {
  const asset = await loadMediaAsset(organizationId, assetId);
  if (!asset) throw new MultimediaError("Un archivo ya no está en la Biblioteca; quítalo y vuelve a elegirlo.");
  if (!isMultimedia(asset.kind)) throw new MultimediaError("Multimedia solo manda fotos y videos.");
  return {
    storageKey: asset.storageKey,
    kind: asset.kind,
    mime: asset.mimeType,
    fileName: asset.fileName,
    bytes: asset.bytes,
    messageId: multimediaMessageId(sendId, asset.id),
  };
}
