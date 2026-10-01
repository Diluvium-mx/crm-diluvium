"use client";

// pdf.js en el visor de adjuntos (1-oct-2026): el PDF lo dibuja el CRM en vez del
// visor de Chrome dentro de un iframe. Así el mouse (deslizar entre archivos) llega
// también encima de la hoja, la impresión sale página por página y el PDF no corre
// código (pdf.js 6 no usa eval). Se carga solo al abrir un PDF; los bytes llegan de
// /api/media?bytes=1 (mismo dominio: el navegador no deja leer los del bucket).
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let lib: Promise<{ mod: PdfJs; worker: PDFWorker }> | null = null;

function pdfjs(): Promise<{ mod: PdfJs; worker: PDFWorker }> {
  lib ??= import("pdfjs-dist").then((mod) => {
    // Un solo worker para todo el CRM, creado aquí y entregado a cada documento: así
    // cerrar un PDF no lo apaga (pdf.js solo apaga el worker que crea él mismo). Si se
    // apagara, el siguiente PDF que se abre justo después fallaba ("worker is being destroyed").
    const port = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return { mod, worker: mod.PDFWorker.create({ port }) };
  });
  return lib;
}

/** La misma ruta del adjunto, pero entregando el archivo desde este dominio. */
export function bytesUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}bytes=1`;
}

// Documentos abiertos mientras el visor está abierto (verlo e imprimirlo lo carga una vez).
const open = new Map<string, Promise<PDFDocumentLoadingTask>>();

export function getPdf(url: string): Promise<PDFDocumentProxy> {
  let task = open.get(url);
  if (!task) {
    task = pdfjs().then(({ mod, worker }) =>
      mod.getDocument({
        url: bytesUrl(url),
        worker,
        // Sin WebAssembly (la política de contenido no lo permite). pdf.js 6 ya no ejecuta
        // código del PDF (sin eval; el CVE-2024-4367 se cerró en la 4.2.67).
        useWasm: false,
        enableXfa: false,
      }),
    );
    open.set(url, task);
  }
  return task
    .then((t) => t.promise)
    .catch((error: unknown) => {
      open.delete(url);
      throw error;
    });
}

/** Al cerrar el visor: libera los PDF cargados (memoria del worker; el worker sigue vivo). */
export function releasePdfs(): void {
  for (const task of open.values()) void task.then((t) => t.destroy()).catch(() => undefined);
  open.clear();
}
