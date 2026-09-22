// Miniatura de la 1ª página y número de páginas de los PDF recibidos (tarjeta
// de documento estilo WhatsApp). Corre en el WORKER, después de copiar el
// archivo al bucket: el mensaje ya se ve desde antes con su tarjeta básica, así
// que esto nunca retrasa su llegada. Se genera UNA vez y se guarda en el bucket
// (llave junto al original); un fallo se anota y se reintenta pocas veces.
//
// Render con unpdf (pdf.js de Mozilla, MIT) + @napi-rs/canvas (MIT, binarios
// precompilados) en un PROCESO HIJO (pdf-thumb-child.mjs) con memoria y tiempo
// limitados: un PDF hostil no puede tumbar ni bloquear al worker de webhooks.
import { spawn } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, type MessageAttachment } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";

export const THUMBNAIL_MAX_ATTEMPTS = 3;
/** Un PDF más grande no se renderiza; se muestra sin miniatura. */
const THUMBNAIL_MAX_PDF_BYTES = 10 * 1024 * 1024;
/**
 * Límites del proceso hijo. OJO: --max-old-space-size acota el heap de V8, NO
 * toda la memoria (buffers y canvas nativo quedan fuera); por eso además se
 * renderiza UN PDF a la vez en todo el worker (renderQueue) y el PDF se limita
 * a 10 MB. Sin un contenedor aparte no hay aislamiento total de memoria.
 */
const CHILD_TIMEOUT_MS = 20_000;
const CHILD_MAX_OLD_SPACE_MB = 256;
/** Un reclamo más viejo que esto se da por muerto (el proceso cayó a medias) y se puede retomar. */
const CLAIM_LEASE_MS = 2 * 60_000;

export function isPdf(attachment: Pick<MessageAttachment, "mimeType" | "fileName">): boolean {
  return attachment.mimeType === "application/pdf" || /\.pdf$/i.test(attachment.fileName ?? "");
}

/** ¿A este adjunto le falta (y le toca) su miniatura, y nadie la está generando? */
export function needsThumbnail(attachment: MessageAttachment, now = Date.now()): boolean {
  const claimedAt = attachment.thumbnailClaimedAt ? Date.parse(attachment.thumbnailClaimedAt) : 0;
  return (
    isPdf(attachment) &&
    Boolean(attachment.storageKey) &&
    !attachment.thumbnailKey &&
    (attachment.thumbnailAttempts ?? 0) < THUMBNAIL_MAX_ATTEMPTS &&
    now - claimedAt > CLAIM_LEASE_MS
  );
}

// Un render a la vez en todo el proceso (los jobs de media y el barrido comparten esta cola).
let renderQueue: Promise<unknown> = Promise.resolve();
function renderOneAtATime(bytes: Uint8Array): Promise<{ png: Uint8Array; pageCount: number }> {
  const run = renderQueue.then(() => renderInChild(bytes));
  renderQueue = run.catch(() => undefined);
  return run;
}

/** Renderiza en un proceso aparte; lo mata si pasa del tiempo o de la memoria. */
function renderInChild(bytes: Uint8Array): Promise<{ png: Uint8Array; pageCount: number }> {
  const script = path.join(process.cwd(), "lib/messaging/pdf-thumb-child.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`, script], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const out: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`render de PDF excedió ${CHILD_TIMEOUT_MS / 1000} s`));
    }, CHILD_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal || code !== 0) return reject(new Error(`render de PDF abortado (${signal ?? `código ${code}`})`));
      try {
        const result = JSON.parse(Buffer.concat(out).toString("utf8")) as { pageCount?: number; png?: string; error?: string };
        if (result.error || !result.png || !result.pageCount) return reject(new Error(result.error ?? "render sin resultado"));
        resolve({ png: new Uint8Array(Buffer.from(result.png, "base64")), pageCount: result.pageCount });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on("error", () => {}); // el hijo pudo morir antes de leer todo
    child.stdin.end(Buffer.from(bytes));
  });
}

async function writeAttachments(
  messageId: string,
  organizationId: string,
  apply: (attachment: MessageAttachment, index: number) => MessageAttachment,
): Promise<MessageAttachment[] | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ attachments: messages.attachments })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)))
      .for("update");
    if (!current) return null;
    const merged = current.attachments.map(apply);
    await tx
      .update(messages)
      .set({ attachments: merged })
      .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)));
    return merged;
  });
}

/**
 * Genera las miniaturas que falten de un mensaje. Antes de renderizar RECLAMA
 * cada adjunto (thumbnailClaimedAt + intento sumado, en la base): otro barrido
 * o el job de media no lo toman mientras tanto, y si el proceso cae a medias el
 * intento ya quedó contado. Un PDF que no se puede renderizar no lanza: el
 * error queda en el adjunto. Devuelve cuántas generó.
 */
export async function generateMessageThumbnails(storage: ObjectStorage, messageId: string): Promise<number> {
  const [message] = await db
    .select({ id: messages.id, organizationId: messages.organizationId })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!message) return 0;

  // 1) Reclamo atómico.
  const claimed = new Set<number>();
  const now = new Date();
  // Identificador de ESTE reclamo: el resultado solo se aplica (y el reclamo
  // solo se libera) si sigue siendo el vigente; un render que venció su plazo
  // no pisa al que lo retomó.
  const claimId = crypto.randomUUID();
  const afterClaim = await writeAttachments(message.id, message.organizationId, (attachment, index) => {
    if (!needsThumbnail(attachment, now.getTime())) return attachment;
    claimed.add(index);
    return {
      ...attachment,
      thumbnailClaimedAt: now.toISOString(),
      thumbnailClaimId: claimId,
      thumbnailAttempts: (attachment.thumbnailAttempts ?? 0) + 1,
    };
  });
  if (!afterClaim || claimed.size === 0) return 0;

  // 2) Render (fuera de la transacción) y subida.
  const results = new Map<number, Partial<MessageAttachment>>();
  for (const index of claimed) {
    const attachment = afterClaim[index];
    if (!attachment.storageKey) continue;
    const thumbnailKey = `${attachment.storageKey}.thumb.png`;
    try {
      const bytes = await storage.getBytes(attachment.storageKey, THUMBNAIL_MAX_PDF_BYTES);
      const { png, pageCount } = await renderOneAtATime(bytes);
      await storage.putStream(thumbnailKey, Readable.from(Buffer.from(png)), "image/png");
      results.set(index, { thumbnailKey, pageCount });
    } catch (error) {
      results.set(index, { thumbnailError: error instanceof Error ? error.message : String(error) });
    }
  }

  // 3) Resultado y liberación del reclamo.
  let generated = 0;
  await writeAttachments(message.id, message.organizationId, (attachment, index) => {
    const update = results.get(index);
    if (!update || attachment.thumbnailKey || attachment.thumbnailClaimId !== claimId) return attachment;
    const next: MessageAttachment = { ...attachment, ...update };
    delete next.thumbnailClaimedAt;
    delete next.thumbnailClaimId;
    if (update.thumbnailKey) {
      delete next.thumbnailError;
      generated++;
    }
    return next;
  });
  return generated;
}
