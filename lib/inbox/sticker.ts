// Sticker de WhatsApp en el chat (30-sep-2026, decisión del dueño): se pinta como en
// WhatsApp —tamaño fijo y sin burbuja— y con «Sticker» junto a la hora, para que nunca
// se confunda con una foto (caso Alberto: un sticker hecho de una foto parecía imagen).
// Todos miden 512×512 con fondo transparente (verificado en prod), así que el cuadro
// fijo con object-contain nunca los recorta. Regla pura: la UI solo la pinta.
import type { MessageView } from "./types";

export const STICKER_LABEL = "Sticker";
/** Lado del cuadro del sticker en px (WhatsApp los muestra de un tamaño fijo). */
export const STICKER_SIZE_PX = 160;

/** Etiqueta del pie de la burbuja ("Sticker · 12:52 p.m."), o null si no trae sticker. */
export function bubbleKindLabel(attachments: readonly Pick<MessageView["attachments"][number], "kind">[]): string | null {
  return attachments.some((a) => a.kind === "sticker") ? STICKER_LABEL : null;
}

/**
 * Sticker suelto: solo stickers, sin texto ni nada más que pintar dentro de la burbuja
 * (cita, anuncio, aviso, ubicación, tarjetas, "eliminado"). Ese va sin burbuja, como en
 * WhatsApp; cualquier otro caso conserva la burbuja y solo lleva la etiqueta.
 */
export function isBareSticker(
  message: Pick<
    MessageView,
    "body" | "attachments" | "quoted" | "adReferral" | "deletedAt" | "noDisponible" | "location" | "contactCards"
  >,
): boolean {
  return (
    message.attachments.length > 0 &&
    message.attachments.every((a) => a.kind === "sticker") &&
    !message.body?.trim() &&
    !message.quoted &&
    !message.adReferral &&
    !message.deletedAt &&
    !message.noDisponible &&
    !message.location &&
    message.contactCards.length === 0
  );
}
