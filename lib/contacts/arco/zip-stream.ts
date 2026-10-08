// Zip EN STREAMING (fflate) para la exportación de un contacto (ARCO, 7-oct-2026). Se arma pieza
// por pieza conforme el navegador lo pide (`pull`): cada archivo del bucket se lee de a pedazos y
// pasa directo al zip, así la memoria no depende de cuántos ni de qué tan grandes sean. Los textos
// (datos.json, chat.txt) se comprimen; fotos, audios y videos ya vienen comprimidos y van tal cual.
import { Zip, ZipDeflate, ZipPassThrough, type FlateError } from "fflate";

export type ZipEntry =
  | { name: string; data: Uint8Array; mtime?: Date }
  | { name: string; body: ReadableStream<Uint8Array>; mtime?: Date };

/**
 * Zip de las entradas que va dando `entries` (en orden). El iterable abre cada archivo justo
 * cuando le toca, y si uno no se puede abrir decide qué hacer (p. ej. anotarlo y seguir). Un
 * error A MEDIO archivo corta la descarga con error (nunca entrega un zip corrupto como bueno).
 */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const ready: Uint8Array[] = [];
  let finished = false;
  let failure: FlateError | null = null;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      return;
    }
    ready.push(chunk);
    if (final) finished = true;
  });
  const iterator = entries[Symbol.asyncIterator]();
  let current: { file: ZipPassThrough; reader: ReadableStreamDefaultReader<Uint8Array> } | null = null;
  let ended = false;

  // Un paso: un pedazo del archivo en curso, o abrir la siguiente entrada, o cerrar el zip.
  async function step(): Promise<void> {
    if (current) {
      const { value, done } = await current.reader.read();
      if (done) {
        current.file.push(new Uint8Array(0), true);
        current = null;
      } else if (value.byteLength > 0) {
        current.file.push(value);
      }
      return;
    }
    const next = await iterator.next();
    if (next.done) {
      zip.end();
      ended = true;
      return;
    }
    const entry = next.value;
    if ("data" in entry) {
      const file = new ZipDeflate(entry.name, { level: 6 });
      file.mtime = entry.mtime;
      zip.add(file);
      file.push(entry.data, true);
      return;
    }
    const file = new ZipPassThrough(entry.name);
    file.mtime = entry.mtime;
    zip.add(file);
    current = { file, reader: entry.body.getReader() };
  }

  async function cleanup(): Promise<void> {
    await current?.reader.cancel().catch(() => undefined);
    current = null;
    await iterator.return?.().catch(() => undefined);
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (ready.length === 0 && !finished) {
          if (failure) throw failure;
          if (ended) throw new Error("el zip se cerró sin terminar");
          await step();
        }
        if (failure) throw failure;
        while (ready.length > 0) controller.enqueue(ready.shift() as Uint8Array);
        if (finished) controller.close();
      } catch (error) {
        zip.terminate();
        await cleanup();
        controller.error(error);
      }
    },
    async cancel() {
      zip.terminate();
      await cleanup();
    },
  });
}
