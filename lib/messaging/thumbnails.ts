// Miniatura de la 1ª página y número de páginas de los PDF recibidos (tarjeta
// de documento estilo WhatsApp). Corre en el WORKER, después de copiar el
// archivo al bucket: el mensaje ya se ve desde antes con su tarjeta básica, así
// que esto nunca retrasa su llegada. Se genera UNA vez y se guarda en el bucket
// (llave junto al original); un fallo se anota y se reintenta pocas veces.
//
// Render con unpdf (pdf.js de Mozilla, MIT) + @napi-rs/canvas (MIT, binarios
// precompilados, sin dependencias del sistema).
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, type MessageAttachment } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";

export const THUMBNAIL_MAX_ATTEMPTS = 3;
/** Un PDF más grande no se renderiza (memoria del worker); se muestra sin miniatura. */
const THUMBNAIL_MAX_PDF_BYTES = 25 * 1024 * 1024;
const THUMBNAIL_WIDTH = 320;

export function isPdf(attachment: Pick<MessageAttachment, "mimeType" | "fileName">): boolean {
  return attachment.mimeType === "application/pdf" || /\.pdf$/i.test(attachment.fileName ?? "");
}

/** ¿A este adjunto le falta (y le toca) su miniatura? */
export function needsThumbnail(attachment: MessageAttachment): boolean {
  return (
    isPdf(attachment) &&
    Boolean(attachment.storageKey) &&
    !attachment.thumbnailKey &&
    (attachment.thumbnailAttempts ?? 0) < THUMBNAIL_MAX_ATTEMPTS
  );
}

async function renderPdf(bytes: Uint8Array): Promise<{ png: Uint8Array; pageCount: number }> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const doc = await getDocumentProxy(bytes.slice());
  const pageCount = doc.numPages;
  await doc.cleanup();
  const png = await renderPageAsImage(bytes.slice(), 1, {
    canvasImport: () => import("@napi-rs/canvas"),
    width: THUMBNAIL_WIDTH,
  });
  return { png: new Uint8Array(png), pageCount };
}

/**
 * Genera las miniaturas que falten de un mensaje. Un PDF que no se puede
 * renderizar no lanza: el error queda en el adjunto (thumbnailError) y la UI
 * muestra la tarjeta sin miniatura. Devuelve cuántas generó.
 */
export async function generateMessageThumbnails(storage: ObjectStorage, messageId: string): Promise<number> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) return 0;

  const results = new Map<number, Partial<MessageAttachment>>();
  for (const [index, attachment] of message.attachments.entries()) {
    if (!needsThumbnail(attachment) || !attachment.storageKey) continue;
    const thumbnailKey = `${attachment.storageKey}.thumb.png`;
    try {
      const bytes = await storage.getBytes(attachment.storageKey, THUMBNAIL_MAX_PDF_BYTES);
      const { png, pageCount } = await renderPdf(bytes);
      await storage.putStream(thumbnailKey, Readable.from(Buffer.from(png)), "image/png");
      results.set(index, { thumbnailKey, pageCount, thumbnailError: undefined });
    } catch (error) {
      results.set(index, { thumbnailError: error instanceof Error ? error.message : String(error) });
    }
  }
  if (results.size === 0) return 0;

  let generated = 0;
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ attachments: messages.attachments })
      .from(messages)
      .where(and(eq(messages.id, message.id), eq(messages.organizationId, message.organizationId)))
      .for("update");
    if (!current) return;
    const merged = current.attachments.map((attachment, index) => {
      const update = results.get(index);
      if (!update || attachment.thumbnailKey) return attachment;
      const next: MessageAttachment = {
        ...attachment,
        ...update,
        thumbnailAttempts: (attachment.thumbnailAttempts ?? 0) + 1,
      };
      if (!update.thumbnailError) {
        delete next.thumbnailError;
        generated++;
      }
      return next;
    });
    await tx
      .update(messages)
      .set({ attachments: merged })
      .where(and(eq(messages.id, message.id), eq(messages.organizationId, message.organizationId)));
  });
  return generated;
}
