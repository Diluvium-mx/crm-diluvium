// Guardar un adjunto del chat en el bucket (28-sep-2026). En streaming: el
// archivo nunca se junta completo en memoria. Antes de dejar pasar el primer
// byte al bucket se leen los primeros 64 KB y se confirma el tipo REAL
// (sniff.ts); se cuentan los bytes (si pasa el límite de WhatsApp, se aborta y
// no queda objeto) y en video se revisa que no sea HEVC. Sin "server-only": lo
// usa la ruta de subida.
import { Transform, type Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import type { ObjectStorage } from "@/lib/storage/s3";
import { chatUploadKey } from "./keys";
import { acceptedType, maxBytesFor, notAcceptedMessage, type ChatFileKind } from "./rules";
import { H264_MARKER, HEVC_MARKERS, SNIFF_BYTES, sniffChatFile } from "./sniff";
import { signChatUpload } from "./token";

export class ChatUploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatUploadRejectedError";
  }
}

export type ChatUploadResult = { token: string; fileName: string; kind: ChatFileKind; mime: string; bytes: number };

const LARGEST = Math.max(maxBytesFor("image"), maxBytesFor("video"), maxBytesFor("document"));
/** Una subida que deja de mandar datos este tiempo se corta (no retiene memoria ni conexión). */
export const UPLOAD_IDLE_MS = 60_000;
// Controles, invisibles y marcas de dirección (bidi): un nombre como "Factura_\u202Efdp.exe" engañaría al cliente.
const BAD_NAME_CHARS = /[\\/\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
const HEVC = HEVC_MARKERS.map((m) => Buffer.from(m));
const H264 = Buffer.from(H264_MARKER);

/** Transform que valida el tipo con los primeros bytes, cuenta y corta en el límite. */
function validatingStream(fileName: string) {
  let head: Buffer[] = [];
  let headBytes = 0;
  let decided: { kind: ChatFileKind; mime: string } | null = null;
  let size = 0;
  let tail = Buffer.alloc(0);
  let sawHevc = false;
  let sawH264 = false;

  const decide = (stream: Transform): Error | null => {
    const r = sniffChatFile(new Uint8Array(Buffer.concat(head)), fileName);
    if (!r.ok) return new ChatUploadRejectedError(r.message);
    decided = { kind: r.kind, mime: r.mime };
    if (size > maxBytesFor(r.kind)) return tooBig(r.kind);
    for (const chunk of head) inspect(chunk);
    for (const chunk of head) stream.push(chunk);
    head = [];
    return null;
  };
  const tooBig = (kind: ChatFileKind) =>
    new ChatUploadRejectedError(`"${fileName}" pasa del límite de WhatsApp (${Math.round(maxBytesFor(kind) / 1024 / 1024)} MB).`);
  const inspect = (chunk: Buffer) => {
    if (decided?.kind !== "video") return;
    const window = Buffer.concat([tail, chunk]);
    if (!sawHevc && HEVC.some((m) => window.includes(m))) sawHevc = true;
    if (!sawH264 && window.includes(H264)) sawH264 = true;
    tail = window.subarray(Math.max(0, window.length - 8));
  };

  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stream.destroy(new ChatUploadRejectedError(`La subida de "${fileName}" se detuvo; vuelve a adjuntarlo.`)), UPLOAD_IDLE_MS);
  };
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      touch();
      size += chunk.byteLength;
      if (size > (decided ? maxBytesFor(decided.kind) : LARGEST)) return cb(decided ? tooBig(decided.kind) : new ChatUploadRejectedError(`"${fileName}" es demasiado grande.`));
      if (decided) {
        inspect(chunk);
        return cb(null, chunk);
      }
      head.push(chunk);
      headBytes += chunk.byteLength;
      if (headBytes < SNIFF_BYTES) return cb();
      cb(decide(this) ?? undefined);
    },
    flush(cb) {
      clearTimeout(idle);
      if (!decided) {
        const error = decide(this);
        if (error) return cb(error);
      }
      cb();
    },
  });
  stream.on("close", () => clearTimeout(idle));
  touch();
  return {
    stream,
    size: () => size,
    type: () => decided,
    hevcOnly: () => sawHevc && !sawH264,
  };
}

/** La conversación existe y es de la organización de la sesión. */
async function assertConversation(organizationId: string, conversationId: string): Promise<void> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ChatUploadRejectedError("Conversación no encontrada.");
}

/**
 * Sube un adjunto del chat y devuelve su comprobante firmado. Lo declarado por
 * el navegador (nombre, tamaño) se valida antes de leer; el tipo y el tamaño
 * reales, mientras se sube. Si algo falla, no queda objeto en el bucket.
 */
export async function storeChatUpload(
  storage: ObjectStorage,
  input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    fileName: string;
    declaredBytes: number;
    body: Readable;
    now?: Date;
  },
): Promise<ChatUploadResult> {
  const fileName = input.fileName.normalize("NFC").trim();
  if (!fileName || fileName.length > 150 || BAD_NAME_CHARS.test(fileName)) throw new ChatUploadRejectedError("Nombre de archivo inválido.");
  const type = acceptedType(fileName);
  if (!type) throw new ChatUploadRejectedError(notAcceptedMessage(fileName));
  if (input.declaredBytes > maxBytesFor(type.kind)) throw new ChatUploadRejectedError(`"${fileName}" pasa del límite de WhatsApp.`);
  await assertConversation(input.organizationId, input.conversationId);

  const now = input.now ?? new Date();
  const key = chatUploadKey(input.organizationId, crypto.randomUUID(), fileName, now);
  const v = validatingStream(fileName);
  input.body.on("error", (e) => v.stream.destroy(e));
  v.stream.on("error", () => input.body.destroy());
  try {
    await storage.putStream(key, input.body.pipe(v.stream), type.mime);
  } finally {
    input.body.destroy();
  }
  const decided = v.type();
  const reject = async (message: string) => {
    await storage.deleteObject(key).catch(() => undefined);
    throw new ChatUploadRejectedError(message);
  };
  if (!decided || v.size() === 0) return reject(`"${fileName}" está vacío.`);
  if (v.hevcOnly()) {
    return reject(`"${fileName}" está en HEVC (H.265, típico de iPhone) y WhatsApp no lo reproduce. Conviértelo a MP4 H.264 y vuelve a adjuntarlo.`);
  }
  const token = signChatUpload({
    storageKey: key,
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId: input.conversationId,
    uploadedAt: now.getTime(),
    kind: decided.kind,
    mime: decided.mime,
    fileName,
    bytes: v.size(),
  });
  return { token, fileName, kind: decided.kind, mime: decided.mime, bytes: v.size() };
}
