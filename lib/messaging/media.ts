// Descarga de adjuntos recibidos a almacenamiento propio (bucket de Railway).
//
// Por qué: WhatsApp no entrega el archivo, entrega un enlace que depende de
// que Meta conserve la media; después caduca y el adjunto se perdería. El
// worker copia cada archivo en cuanto llega:
// - en streaming: verifica tamaño y sha256 al vuelo mientras sube por partes,
//   sin cargar el archivo en memoria; si no cuadra, la subida se aborta
//   (archivo íntegro o se reintenta);
// - llave determinista org/{org}/messages/{msg}/{i}-{nombre}: reintentar no
//   duplica; si el objeto ya existe (subida previa sin anotar), se reutiliza;
// - anota storageKey por adjunto, con la fila bloqueada (FOR UPDATE) para no
//   pisar el trabajo de otro intento concurrente;
// - si un adjunto falla, anota el error y lanza para que BullMQ reintente; el
//   barrido del worker recoge lo que quede pendiente.
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, type MessageAttachment } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";
import { storageKeyFor } from "./media-keys";
import type { MessagingProvider } from "./provider";

export { sha256Base64, storageKeyFor } from "./media-keys";

// Límite de WhatsApp para documentos: 100 MB.
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export class MediaDownloadError extends Error {}

/**
 * Pasa los bytes tal cual, contando y calculando el sha256 al vuelo (nada se
 * acumula en memoria). Falla en cuanto se pasa del límite, y al final si el
 * hash no coincide: como falla ANTES de terminar el stream, la subida se
 * aborta y el bucket nunca guarda un archivo incompleto o alterado.
 */
function verifyingStream(maxBytes: number, expectedSha256: string | undefined) {
  const hash = createHash("sha256");
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      if (size > maxBytes) return callback(new MediaDownloadError(`archivo excede ${maxBytes} bytes`));
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      if (expectedSha256 && hash.digest("base64") !== expectedSha256) {
        return callback(new MediaDownloadError("el sha256 no coincide: archivo incompleto o alterado"));
      }
      callback();
    },
  });
  return { stream, size: () => size };
}

async function downloadOne(
  provider: MessagingProvider,
  storage: ObjectStorage,
  key: string,
  attachment: MessageAttachment,
  maxBytes: number,
): Promise<{ sizeBytes: number }> {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const res = await provider.fetchMedia(attachment.url, signal);
  if (!res.ok) throw new MediaDownloadError(`descarga respondió ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new MediaDownloadError(`archivo de ${declared} bytes excede ${maxBytes}`);
  }
  const source = res.body ? Readable.fromWeb(res.body as WebReadableStream<Uint8Array>) : Readable.from([]);
  const verifier = verifyingStream(maxBytes, attachment.sha256);
  // Un error de la descarga (corte, timeout) también rompe el stream que se sube.
  source.on("error", (error) => verifier.stream.destroy(error));
  verifier.stream.on("error", () => source.destroy());
  const contentType = attachment.mimeType ?? res.headers.get("content-type") ?? "application/octet-stream";
  try {
    await storage.putStream(key, source.pipe(verifier.stream), contentType);
  } finally {
    source.destroy(); // si el bucket falló a la mitad, se corta también la descarga
  }
  return { sizeBytes: verifier.size() };
}

/** Descarga los adjuntos pendientes de un mensaje. Devuelve cuántos guardó. */
export async function downloadMessageMedia(
  provider: MessagingProvider,
  storage: ObjectStorage,
  messageId: string,
  { maxBytes = MAX_MEDIA_BYTES }: { maxBytes?: number } = {},
): Promise<{ stored: number; pending: number }> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) return { stored: 0, pending: 0 };

  const results = new Map<number, Partial<MessageAttachment>>();
  const errors: string[] = [];
  for (const [index, attachment] of message.attachments.entries()) {
    if (attachment.storageKey) continue;
    const key = storageKeyFor(message.organizationId, message.id, index, attachment);
    try {
      const { sizeBytes } = await downloadOne(provider, storage, key, attachment, maxBytes);
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
