// Leer el principio de un stream SIN consumirlo (S2, 30-sep-2026): para revisar
// el tipo real de un archivo por sus primeros bytes antes de subirlo al bucket
// (el Content-Type del objeto se fija al empezar la subida).
import { Readable } from "node:stream";

// Sin copiar: un Buffer pasa tal cual; un Uint8Array se envuelve.
const asBuffer = (v: Uint8Array) => (Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength));

/**
 * Lee los primeros `want` bytes para decidir el tipo ANTES de subir (el
 * Content-Type del objeto se fija al empezar la subida) y devuelve un stream
 * con el archivo COMPLETO (lo leído + el resto), sin juntarlo en memoria.
 */
export async function peekHead(source: Readable, want: number): Promise<{ head: Uint8Array; whole: Readable }> {
  const it = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  const chunks: Buffer[] = [];
  let size = 0;
  let ended = false;
  while (size < want) {
    const next = await it.next();
    if (next.done) {
      ended = true;
      break;
    }
    chunks.push(asBuffer(next.value));
    size += next.value.byteLength;
  }
  const first = Buffer.concat(chunks);
  const whole = Readable.from(
    (async function* () {
      if (first.byteLength) yield first;
      if (ended) return;
      for (let next = await it.next(); !next.done; next = await it.next()) yield asBuffer(next.value);
    })(),
  );
  return { head: new Uint8Array(first.subarray(0, want)), whole };
}
