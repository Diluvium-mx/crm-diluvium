// Sticker de WhatsApp en el chat (30-sep-2026, decisión del dueño): se pinta como en
// WhatsApp —tamaño fijo, sin burbuja y solo la hora abajo— para que nunca se confunda
// con una foto (caso Alberto: un sticker hecho de una foto parecía imagen). La píldora
// de la hora lleva el color de su lado (blanca del cliente, azul nuestra), no el gris de
// WhatsApp. Todos miden 512×512 con fondo transparente (verificado en prod), así que el
// cuadro fijo con object-contain nunca los recorta. Regla pura: la UI solo la pinta.
import type { MessageView } from "./types";

/** Texto alternativo de la imagen (la burbuja ya no lleva etiqueta: solo la hora). */
export const STICKER_LABEL = "Sticker";
/** Lado del cuadro del sticker en px (WhatsApp los muestra de un tamaño fijo). */
export const STICKER_SIZE_PX = 160;

/**
 * Sticker suelto: solo stickers, sin texto ni nada más que pintar dentro de la burbuja
 * (cita, anuncio, aviso, ubicación, tarjetas, "eliminado"). Ese va sin burbuja, como en
 * WhatsApp; cualquier otro caso conserva su burbuja normal.
 */
export function isBareSticker(
  message: Pick<
    MessageView,
    "body" | "attachments" | "quoted" | "adReferral" | "deletedAt" | "noDisponible" | "location" | "contactCards"
  >,
): boolean {
  return (
    message.attachments.length > 0 &&
    // S2: un sticker que sus bytes no confirman se ve como archivo para descargar, en burbuja normal.
    message.attachments.every((a) => a.kind === "sticker" && (a.state !== "ready" || a.preview === "image")) &&
    !message.body?.trim() &&
    !message.quoted &&
    !message.adReferral &&
    !message.deletedAt &&
    !message.noDisponible &&
    !message.location &&
    message.contactCards.length === 0
  );
}
