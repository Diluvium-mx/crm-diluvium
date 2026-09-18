// Descarga de adjuntos recibidos a almacenamiento propio (bucket de Railway).
//
// Por qué: WhatsApp no entrega el archivo, entrega un enlace que depende de
// que Meta conserve la media; después caduca y el adjunto se perdería. El
// worker copia cada archivo en cuanto llega:
// - verifica el sha256 que manda WhatsApp (archivo íntegro o se reintenta);
// - llave determinista org/{org}/messages/{msg}/{i}-{nombre}: reintentar no
//   duplica; si el objeto ya existe (subida previa sin anotar), se reutiliza;
// - anota storageKey por adjunto, con la fila bloqueada (FOR UPDATE) para no
//   pisar el trabajo de otro intento concurrente;
// - si un adjunto falla, anota el error y lanza para que BullMQ reintente; el
//   barrido del worker recoge lo que quede pendiente.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, type MessageAttachment } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";
import { sha256Base64, storageKeyFor } from "./media-keys";
import type { MessagingProvider } from "./provider";

export { sha256Base64, storageKeyFor } from "./media-keys";

// Límite de WhatsApp para documentos: 100 MB.
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export class MediaDownloadError extends Error {}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new MediaDownloadError(`archivo de ${declared} bytes excede ${maxBytes}`);
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new MediaDownloadError(`archivo excede ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function downloadOne(
  provider: MessagingProvider,
  storage: ObjectStorage,
  key: string,
  attachment: MessageAttachment,
): Promise<{ sizeBytes: number }> {
  const res = await provider.fetchMedia(attachment.url, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS));
  if (!res.ok) throw new MediaDownloadError(`descarga respondió ${res.status}`);
  const data = await readLimited(res, MAX_MEDIA_BYTES);
  if (attachment.sha256 && sha256Base64(data) !== attachment.sha256) {
    throw new MediaDownloadError("el sha256 no coincide: archivo incompleto o alterado");
  }
  const contentType = attachment.mimeType ?? res.headers.get("content-type") ?? "application/octet-stream";
  await storage.put(key, data, contentType);
  return { sizeBytes: data.byteLength };
}

/** Descarga los adjuntos pendientes de un mensaje. Devuelve cuántos guardó. */
export async function downloadMessageMedia(
  provider: MessagingProvider,
  storage: ObjectStorage,
  messageId: string,
): Promise<{ stored: number; pending: number }> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) return { stored: 0, pending: 0 };

  const results = new Map<number, Partial<MessageAttachment>>();
  const errors: string[] = [];
  for (const [index, attachment] of message.attachments.entries()) {
    if (attachment.storageKey) continue;
    const key = storageKeyFor(message.organizationId, message.id, index, attachment);
    try {
      const { sizeBytes } = await downloadOne(provider, storage, key, attachment);
      results.set(index, { storageKey: key, sizeBytes, downloadedAt: new Date().toISOString(), downloadError: undefined });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Si ya se había subido en un intento previo que no alcanzó a anotarlo, se reutiliza.
      if (await storage.exists(key).catch(() => false)) {
        results.set(index, { storageKey: key, downloadedAt: new Date().toISOString(), downloadError: undefined });
      } else {
        results.set(index, { downloadError: reason });
        errors.push(`adjunto ${index}: ${reason}`);
      }
    }
  }
  if (results.size === 0) return { stored: 0, pending: 0 };

  let stored = 0;
  let pending = 0;
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ attachments: messages.attachments })
      .from(messages)
      .where(and(eq(messages.id, message.id), eq(messages.organizationId, message.organizationId)))
      .for("update");
    const merged = current.attachments.map((attachment, index) => {
      const update = results.get(index);
      if (!update || attachment.storageKey) return attachment; // otro intento ya lo guardó
      const next: MessageAttachment = {
        ...attachment,
        ...update,
        downloadAttempts: (attachment.downloadAttempts ?? 0) + 1,
      };
      if (!update.downloadError) delete next.downloadError;
      return next;
    });
    stored = merged.filter((a) => a.storageKey).length;
    pending = merged.length - stored;
    await tx
      .update(messages)
      .set({ attachments: merged })
      .where(and(eq(messages.id, message.id), eq(messages.organizationId, message.organizationId)));
  });

  if (errors.length) throw new MediaDownloadError(errors.join("; "));
  return { stored, pending };
}
