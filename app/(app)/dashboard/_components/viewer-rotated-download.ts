"use client";

// Descargar una foto GIRADA en el visor (1-oct-2026): se guarda tal como se ve, con
// su tamaño original, el mismo nombre y el mismo formato. Sin giro, el visor baja el
// archivo original sin tocarlo (no pasa por aquí).
import type { AttachmentView } from "@/lib/inbox/types";
import { quarterTurns, rotatedImageFile } from "@/lib/inbox/viewer";
import { bytesUrl } from "./viewer-pdf-document";

export async function downloadRotatedImage(attachment: AttachmentView, rotDeg: number): Promise<void> {
  const res = await fetch(bytesUrl(attachment.url));
  if (!res.ok) throw new Error(`no se pudo leer la foto (${res.status})`);
  const original = await res.blob();
  // Como la ve el <img>: respetando la orientación que trae la foto (EXIF).
  const bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
  const turns = quarterTurns(rotDeg);
  const canvas = document.createElement("canvas");
  canvas.width = turns % 2 ? bitmap.height : bitmap.width;
  canvas.height = turns % 2 ? bitmap.width : bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const { type, name } = rotatedImageFile(attachment.fileName, original.type);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.95));
  if (!blob) throw new Error("no se pudo guardar la foto");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
