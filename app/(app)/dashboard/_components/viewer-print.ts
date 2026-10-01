"use client";

// «Imprimir» del visor (1-oct-2026). Antes se le pedía a Chrome imprimir el visor
// incrustado y la hoja salía recortada. Ahora se dibuja cada página del PDF a 200 DPI
// y se imprime a su tamaño real, una página por hoja (como el visor de pdf.js): el
// resto del CRM se esconde al imprimir (app/globals.css, #visor-impresion).
import type { PDFDocumentProxy } from "pdfjs-dist";

const PRINT_DPI = 200;
// Lado máximo del canvas: el navegador no dibuja canvas gigantes.
const MAX_SIDE_PX = 4096;

async function buildPages(pdf: PDFDocumentProxy): Promise<{ root: HTMLDivElement; urls: string[]; size: { w: number; h: number } }> {
  const root = document.createElement("div");
  root.id = "visor-impresion";
  const urls: string[] = [];
  let size: { w: number; h: number } | null = null;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const one = page.getViewport({ scale: 1 });
    size ??= { w: one.width, h: one.height };
    const viewport = page.getViewport({ scale: Math.min(PRINT_DPI / 72, MAX_SIDE_PX / Math.max(one.width, one.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, intent: "print" }).promise;
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("no se pudo preparar la página");
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const sheet = document.createElement("div");
    sheet.className = "visor-hoja";
    const img = new Image();
    img.alt = "";
    img.src = url;
    await img.decode();
    sheet.append(img);
    root.append(sheet);
  }
  return { root, urls, size: size ?? { w: 612, h: 792 } };
}

/** Abre el diálogo de impresión con el PDF completo; al cerrarlo, quita todo lo que agregó. */
export async function printPdf(pdf: PDFDocumentProxy): Promise<void> {
  const { root, urls, size } = await buildPages(pdf);
  const pageSize = document.createElement("style");
  pageSize.textContent = `@page { size: ${size.w}pt ${size.h}pt; margin: 0; }`;
  document.head.append(pageSize);
  document.body.append(root);
  document.body.classList.add("visor-imprimiendo");
  const cleanup = () => {
    root.remove();
    pageSize.remove();
    document.body.classList.remove("visor-imprimiendo");
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
}
