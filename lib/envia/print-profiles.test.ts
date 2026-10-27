// Formato de impresión por paquetería (decisión del dueño, 26-oct-2026): Paquetexpress = solo la página de
// la guía (la última; hoy la 3 de 3), Estafeta = su página; todo en hoja CARTA y a tamaño real, para que el
// diálogo de impresión no cambie nada.
import { degrees, PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildPrintReadyPdf, LETTER, placeOnLetter, printProfileFor, rotatedOrigin, selectedPageIndexes } from "./print-profiles";

async function pdfWith(pages: { width: number; height: number; rotate?: number }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const page = doc.addPage([p.width, p.height]);
    // Una guía real siempre trae contenido (pdf-lib no puede incrustar una página vacía).
    page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
    if (p.rotate) page.setRotation(degrees(p.rotate));
  }
  return doc.save();
}

async function sizes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => ({ width: Math.round(p.getWidth()), height: Math.round(p.getHeight()) }));
}

describe("perfiles", () => {
  it("Paquetexpress: la última página; Estafeta y las demás: todas; siempre PDF carta", () => {
    expect(printProfileFor("paquetexpress").pages).toBe("last");
    expect(printProfileFor("Estafeta").pages).toBe("all");
    expect(printProfileFor("dhl").pages).toBe("all");
    expect(printProfileFor("paquetexpress").settings).toEqual({ printFormat: "PDF", printSize: "PAPER_LETTER" });
  });

  it("qué páginas salen", () => {
    expect(selectedPageIndexes(3, "last")).toEqual([2]);
    expect(selectedPageIndexes(1, "last")).toEqual([0]);
    expect(selectedPageIndexes(2, "all")).toEqual([0, 1]);
    expect(selectedPageIndexes(0, "all")).toEqual([]);
  });
});

describe("acomodo en la hoja carta", () => {
  it("una guía 4x6 queda a tamaño real y centrada", () => {
    const p = placeOnLetter(288, 432);
    expect(p).toMatchObject({ sheet: LETTER, scale: 1, width: 288, height: 432, x: 162, y: 180 });
  });

  it("una página carta queda igual", () => {
    expect(placeOnLetter(612, 792)).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  it("una página apaisada va en carta horizontal", () => {
    expect(placeOnLetter(792, 612).sheet).toEqual({ width: 792, height: 612 });
  });

  it("solo se reduce si no cabe, sin deformar", () => {
    const p = placeOnLetter(1224, 792);
    expect(p.sheet).toEqual({ width: 792, height: 612 });
    expect(p.scale).toBeCloseTo(792 / 1224);
    expect(p.width / p.height).toBeCloseTo(1224 / 792);
  });

  it("el giro de la página deja la guía en el mismo recuadro visible", () => {
    expect(rotatedOrigin(0, 10, 20, 100, 50)).toEqual({ x: 10, y: 20, rotate: 0 });
    expect(rotatedOrigin(90, 10, 20, 100, 50)).toEqual({ x: 10, y: 120, rotate: -90 });
    expect(rotatedOrigin(180, 10, 20, 100, 50)).toEqual({ x: 110, y: 70, rotate: 180 });
    expect(rotatedOrigin(270, 10, 20, 100, 50)).toEqual({ x: 60, y: 20, rotate: 90 });
  });
});

describe("PDF listo para imprimir", () => {
  it("Paquetexpress de 3 páginas → solo la 3, en carta", async () => {
    const out = await buildPrintReadyPdf(await pdfWith([LETTER, LETTER, { width: 288, height: 432 }]), "paquetexpress");
    expect(await sizes(out)).toEqual([{ width: 612, height: 792 }]);
  });

  it("Estafeta de 1 página 4x6 → una hoja carta", async () => {
    expect(await sizes(await buildPrintReadyPdf(await pdfWith([{ width: 288, height: 432 }]), "estafeta"))).toEqual([{ width: 612, height: 792 }]);
  });

  it("una página girada 90° (se ve apaisada) va en carta horizontal", async () => {
    expect(await sizes(await buildPrintReadyPdf(await pdfWith([{ width: 612, height: 792, rotate: 90 }]), "estafeta"))).toEqual([{ width: 792, height: 612 }]);
  });

  it("otra paquetería conserva todas sus páginas", async () => {
    expect(await sizes(await buildPrintReadyPdf(await pdfWith([LETTER, LETTER]), "dhl"))).toHaveLength(2);
  });

  it("una página que no se puede incrustar se copia tal cual (sale la página correcta)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([288, 432]);
    expect(await sizes(await buildPrintReadyPdf(await doc.save(), "paquetexpress"))).toEqual([{ width: 288, height: 432 }]);
  });

  it("un archivo que no es PDF falla (no se guarda nada roto)", async () => {
    await expect(buildPrintReadyPdf(new TextEncoder().encode("hola"), "estafeta")).rejects.toThrow();
  });
});
