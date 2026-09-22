// Proceso HIJO que renderiza la miniatura de un PDF (lo lanza thumbnails.ts).
// Aislado a propósito: un PDF hostil (bomba de descompresión, página enorme,
// render infinito) solo puede tumbar ESTE proceso —con memoria y tiempo
// limitados por el padre—, nunca al worker que atiende los webhooks.
// Entrada: bytes del PDF por stdin. Salida: una línea JSON por stdout
// { pageCount, png (base64) } o { error }.
import { getDocumentProxy, renderPageAsImage } from "unpdf";

const MAX_WIDTH = 320;
const MAX_HEIGHT = 480;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

try {
  const bytes = await readStdin();
  const doc = await getDocumentProxy(bytes);
  const pageCount = doc.numPages;
  const page = await doc.getPage(1);
  const { width, height } = page.getViewport({ scale: 1 });
  if (!(width > 0 && height > 0)) throw new Error("página sin dimensiones válidas");
  // Canvas acotado en ANCHO y ALTO: una página con proporción extrema no puede
  // pedir un lienzo gigante.
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
  const png = await renderPageAsImage(doc, 1, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale,
  });
  process.stdout.write(`${JSON.stringify({ pageCount, png: Buffer.from(png).toString("base64") })}\n`);
  process.exit(0);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(0);
}
