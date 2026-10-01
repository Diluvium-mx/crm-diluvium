// Conversión de fotos en el NAVEGADOR antes de subir (28-sep-2026): HEIC/HEIF
// (iPhone), WebP o JPG/PNG de más de 5 MB → JPG de menos de 5 MB, sin servicios
// externos. Safari decodifica HEIC solo; Chrome, Edge y Firefox no, y para ellos
// se carga BAJO DEMANDA la librería del proyecto `heic-to` (libheif en
// WebAssembly, ~3 MB, solo la primera vez que alguien suelta un HEIC).
// Variante `heic-to/csp` (1-oct-2026): la de siempre hace 31 `new Function` dentro
// de su Worker y la CSP no permite 'unsafe-eval'; esta no evalúa código y se llama
// igual (`type: "bitmap"`). La prueba heic-csp.test.ts exige que siga siendo esta.
// Solo navegador: usa createImageBitmap y canvas.
import { jpgName } from "./rules";

// Margen bajo los 5 MB de WhatsApp.
const TARGET_BYTES = 5 * 1024 * 1024 - 64 * 1024;
// Se prueba de más grande a más chico; WhatsApp reduce las fotos a ~1600 px al mostrarlas.
const MAX_SIDES = [4096, 3200, 2560, 2048, 1600];
const QUALITIES = [0.9, 0.82, 0.74];

export class ImageConvertError extends Error {}

function isHeifName(name: string): boolean {
  return /\.(heic|heif)$/i.test(name);
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    if (!isHeifName(file.name) && !/image\/hei[cf]/i.test(file.type)) throw error;
  }
  // Chrome/Edge/Firefox: HEIC con la librería del proyecto (se descarga del propio CRM).
  const { heicTo } = await import("heic-to/csp");
  return heicTo({ blob: file, type: "bitmap", options: { imageOrientation: "from-image" } });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageConvertError("el navegador no pudo generar el JPG"))), "image/jpeg", quality),
  );
}

/** Devuelve la foto como JPG de menos de 5 MB (mismo nombre, extensión .jpg). */
export async function convertToWhatsappJpeg(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new ImageConvertError(`No se pudo leer "${file.name}" en este navegador. Conviértela a JPG y vuelve a adjuntarla.`);
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageConvertError("el navegador no permite convertir imágenes");
    const longest = Math.max(bitmap.width, bitmap.height);
    for (const side of MAX_SIDES) {
      const scale = Math.min(1, side / longest);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // Fondo blanco: un PNG con transparencia saldría negro en JPG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of QUALITIES) {
        const blob = await toJpeg(canvas, q);
        if (blob.size <= TARGET_BYTES) return new File([blob], jpgName(file.name), { type: "image/jpeg", lastModified: Date.now() });
      }
    }
    throw new ImageConvertError(`"${file.name}" no se pudo reducir a menos de 5 MB.`);
  } finally {
    bitmap.close();
  }
}
