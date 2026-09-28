// Comprobante de subida de un adjunto del chat (28-sep-2026), sin tabla nueva:
// la ruta de subida firma (HMAC con el secreto de la app) QUÉ archivo se subió,
// en qué organización, conversación, por qué usuario y cuándo. Al enviar, el
// servidor solo acepta comprobantes suyos, de ESA organización y ESE usuario,
// de hace poco. El navegador no puede inventar ni alterar uno.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ChatFileKind } from "./rules";

/** Un archivo subido se puede mandar hasta 6 h después (los no enviados se borran a las 24 h). */
export const CHAT_UPLOAD_MAX_AGE_MS = 6 * 3_600_000;

export type ChatUpload = {
  storageKey: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  /** epoch ms de la subida. */
  uploadedAt: number;
  kind: ChatFileKind;
  mime: string;
  fileName: string;
  bytes: number;
};

type Wire = { v: 1; k: string; o: string; u: string; c: string; t: number; kd: ChatFileKind; m: string; n: string; b: number };

function secret(): Buffer {
  const raw = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!raw) throw new Error("Falta AUTH_SECRET para firmar los adjuntos del chat");
  // Llave propia derivada del secreto: una firma de adjunto no sirve para nada más.
  return createHash("sha256").update(`crm-diluvium:adjuntos-chat:${raw}`).digest();
}

const b64 = (buf: Buffer) => buf.toString("base64url");

export function signChatUpload(u: ChatUpload): string {
  const wire: Wire = { v: 1, k: u.storageKey, o: u.organizationId, u: u.userId, c: u.conversationId, t: u.uploadedAt, kd: u.kind, m: u.mime, n: u.fileName, b: u.bytes };
  const body = b64(Buffer.from(JSON.stringify(wire)));
  return `${body}.${b64(createHmac("sha256", secret()).update(body).digest())}`;
}

export class ChatUploadTokenError extends Error {}

/**
 * Verifica firma, organización, usuario, conversación y edad. Lanza
 * ChatUploadTokenError con un motivo para el vendedor si no procede.
 */
export function verifyChatUpload(
  token: string,
  expect: { organizationId: string; userId: string; conversationId: string; now?: number },
): ChatUpload {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) throw new ChatUploadTokenError("Adjunto inválido; vuelve a adjuntarlo.");
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ChatUploadTokenError("Adjunto inválido; vuelve a adjuntarlo.");
  let w: Wire;
  try {
    w = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Wire;
  } catch {
    throw new ChatUploadTokenError("Adjunto inválido; vuelve a adjuntarlo.");
  }
  if (w.v !== 1) throw new ChatUploadTokenError("Adjunto inválido; vuelve a adjuntarlo.");
  // Otra organización, otro usuario u otra conversación: mismo mensaje (no se revela nada).
  if (w.o !== expect.organizationId || w.u !== expect.userId || w.c !== expect.conversationId) {
    throw new ChatUploadTokenError("Este archivo no se subió en esta conversación; vuelve a adjuntarlo.");
  }
  const age = (expect.now ?? Date.now()) - w.t;
  if (!(age >= -60_000 && age <= CHAT_UPLOAD_MAX_AGE_MS)) {
    throw new ChatUploadTokenError(`"${w.n}" se subió hace más de 6 horas; vuelve a adjuntarlo.`);
  }
  return { storageKey: w.k, organizationId: w.o, userId: w.u, conversationId: w.c, uploadedAt: w.t, kind: w.kd, mime: w.m, fileName: w.n, bytes: w.b };
}
