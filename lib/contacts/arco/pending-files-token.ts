// Comprobante para REINTENTAR el borrado de archivos de un contacto ya borrado (ARCO, 7-oct-2026).
//
// Al borrar un contacto, la base se confirma primero y los archivos del bucket se borran después.
// Si alguno falla, el contacto ya no existe: no hay de dónde volver a sacar sus llaves. En vez de
// una tabla nueva, el servidor firma (HMAC con el secreto de la app, como los adjuntos del chat en
// lib/chat-attachments/token.ts) QUÉ llaves quedaron, de qué organización y para qué usuario. El
// navegador solo lo guarda y lo devuelve: no lo puede inventar ni alterar, y el servidor vuelve a
// exigir que cada llave sea un archivo propio de mensajes de esa organización (./keys.ts).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Un reintento vale 7 días (después, los archivos quedan para limpieza manual). */
export const PENDING_FILES_MAX_AGE_MS = 7 * 24 * 3_600_000;

export type PendingFiles = { organizationId: string; userId: string; keys: string[]; issuedAt: number };

type Wire = { v: 1; o: string; u: string; k: string[]; t: number };

function secret(): Buffer {
  const raw = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!raw) throw new Error("Falta AUTH_SECRET para firmar el reintento de archivos");
  // Llave propia derivada del secreto: esta firma no sirve para nada más.
  return createHash("sha256").update(`crm-diluvium:arco-archivos:${raw}`).digest();
}

const b64 = (buf: Buffer) => buf.toString("base64url");

export function signPendingFiles(p: PendingFiles): string {
  const wire: Wire = { v: 1, o: p.organizationId, u: p.userId, k: p.keys, t: p.issuedAt };
  const body = b64(Buffer.from(JSON.stringify(wire)));
  return `${body}.${b64(createHmac("sha256", secret()).update(body).digest())}`;
}

export class PendingFilesTokenError extends Error {}

/** Verifica firma, organización, usuario y edad. Lanza PendingFilesTokenError si no procede. */
export function verifyPendingFiles(
  token: string,
  expect: { organizationId: string; userId: string; now?: number },
): PendingFiles {
  const invalid = () => new PendingFilesTokenError("Ese reintento ya no es válido.");
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) throw invalid();
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();
  let w: Wire;
  try {
    w = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Wire;
  } catch {
    throw invalid();
  }
  if (w.v !== 1 || !Array.isArray(w.k) || !w.k.every((k) => typeof k === "string")) throw invalid();
  if (w.o !== expect.organizationId || w.u !== expect.userId) throw invalid();
  const age = (expect.now ?? Date.now()) - w.t;
  if (!(age >= -60_000 && age <= PENDING_FILES_MAX_AGE_MS)) throw invalid();
  return { organizationId: w.o, userId: w.u, keys: w.k, issuedAt: w.t };
}
