// Formato de impresión de cada paquetería (decisión del dueño, 26-oct-2026; docs/envios.md › Impresión).
// La impresora de la oficina es una HP LaserJet P1606dn (láser, CARTA). Hoy se imprime así desde el PDF
// de Envia:
// - Paquetexpress: el PDF trae 3 páginas y solo se imprime la 3 (la guía), escala 100 %, carta, vertical.
// - Estafeta: 1 página, escala 100 %.
// El CRM guarda una copia «lista para imprimir» con SOLO esas páginas, cada una en una hoja carta y a tamaño
// real (centrada). Como la hoja del PDF ya es carta, el diálogo de impresión da lo mismo (100 % o
// «ajustar» salen igual): se elige la HP y «Imprimir».
// Paquetexpress toma la ÚLTIMA página (no «la 3»): si Envia algún día la manda en una sola página, sigue
// saliendo la guía.
import { degrees, PDFDocument } from "pdf-lib";
import type { LabelSettings } from "./client";

export type PageSelection = "all" | "last";

export type PrintProfile = {
  /** Lo que se le pide a Envia al generar. */
  settings: LabelSettings;
  pages: PageSelection;
};

const DEFAULT_PROFILE: PrintProfile = { settings: { printFormat: "PDF", printSize: "PAPER_LETTER" }, pages: "all" };

export const PRINT_PROFILES: Readonly<Record<string, PrintProfile>> = {
  paquetexpress: { settings: { printFormat: "PDF", printSize: "PAPER_LETTER" }, pages: "last" },
  estafeta: { settings: { printFormat: "PDF", printSize: "PAPER_LETTER" }, pages: "all" },
};

export function printProfileFor(carrier: string): PrintProfile {
  return PRINT_PROFILES[carrier.trim().toLowerCase()] ?? DEFAULT_PROFILE;
}

// Carta en puntos PDF (8.5 × 11 in a 72 pt/in).
export const LETTER = { width: 612, height: 792 } as const;

export function selectedPageIndexes(pageCount: number, pages: PageSelection): number[] {
  if (pageCount <= 0) return [];
  return pages === "last" ? [pageCount - 1] : Array.from({ length: pageCount }, (_, i) => i);
}

/**
 * Tamaño y lugar de una página dentro de la hoja carta: a tamaño real y centrada. Una página apaisada va
 * en carta horizontal (la impresora la gira, como el «Giro automático» de hoy). Solo si no cabe se
 * reduce, sin deformarla.
 */
export function placeOnLetter(width: number, height: number) {
  const sheet = width > height ? { width: LETTER.height, height: LETTER.width } : { ...LETTER };
  const scale = Math.min(1, sheet.width / width, sheet.height / height);
  const w = width * scale;
  const h = height * scale;
  return { sheet, scale, x: (sheet.width - w) / 2, y: (sheet.height - h) / 2, width: w, height: h };
}

/**
 * Dónde dibujar una página con giro (/Rotate de 0, 90, 180 o 270, en el sentido del reloj, como la
 * muestra el visor) para que quede como se ve: `pdf-lib` gira alrededor de la esquina inferior izquierda
 * y en contra del reloj. `w` y `h` = tamaño SIN girar ya escalado; (vx, vy) = esquina del recuadro visible.
 */
export function rotatedOrigin(angle: number, vx: number, vy: number, w: number, h: number) {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return { x: vx, y: vy + w, rotate: -90 };
    case 180:
      return { x: vx + w, y: vy + h, rotate: 180 };
    case 270:
      return { x: vx + h, y: vy, rotate: 90 };
    default:
      return { x: vx, y: vy, rotate: 0 };
  }
}

/** El PDF de Envia → el PDF listo para imprimir de esa paquetería. */
export async function buildPrintReadyPdf(labelPdf: Uint8Array, carrier: string): Promise<Uint8Array> {
  const source = await PDFDocument.load(labelPdf, { ignoreEncryption: true });
  const indexes = selectedPageIndexes(source.getPageCount(), printProfileFor(carrier).pages);
  if (indexes.length === 0) throw new Error("La etiqueta de Envia no tiene páginas.");
  try {
    return await onLetterSheets(source, indexes);
  } catch {
    // Una página que pdf-lib no puede incrustar (p. ej. sin contenido propio; falla hasta guardar) se copia
    // tal cual: sale la página correcta, aunque sin acomodar en carta.
    const out = await PDFDocument.create();
    for (const page of await out.copyPages(source, indexes)) out.addPage(page);
    return out.save();
  }
}

async function onLetterSheets(source: PDFDocument, indexes: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = indexes.map((i) => source.getPage(i));
  const embedded = await out.embedPages(pages);
  embedded.forEach((page, i) => {
    const angle = pages[i]!.getRotation().angle;
    const turned = Math.abs(angle % 180) === 90;
    // Tamaño como se VE (con el giro aplicado).
    const place = placeOnLetter(turned ? page.height : page.width, turned ? page.width : page.height);
    const w = page.width * place.scale;
    const h = page.height * place.scale;
    const at = rotatedOrigin(angle, place.x, place.y, w, h);
    out.addPage([place.sheet.width, place.sheet.height]).drawPage(page, { x: at.x, y: at.y, width: w, height: h, rotate: degrees(at.rotate) });
  });
  out.setTitle("Guía de envío");
  out.setProducer("CRM Diluvium");
  return out.save();
}
