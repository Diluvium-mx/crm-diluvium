// Proveedor activo de WhatsApp. Un solo punto donde se elige: para migrar a la
// Cloud API directa de Meta, se agrega su adaptador y se cambia aquí.
import type { MessagingProvider } from "./provider";
import { ZernioProvider } from "./zernio";

let cached: MessagingProvider | undefined;

export function messagingProvider(): MessagingProvider {
  if (cached) return cached;
  const apiKey = process.env.ZERNIO_API_KEY;
  const webhookSecret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) {
    throw new Error("ZERNIO_API_KEY y ZERNIO_WEBHOOK_SECRET son obligatorios para el canal de WhatsApp");
  }
  cached = new ZernioProvider({ apiKey, webhookSecret, baseUrl: process.env.ZERNIO_BASE_URL });
  return cached;
}

/** Id de webhook_events: proveedor + id del evento (BullMQ no acepta ":" en jobId). */
export function webhookEventRowId(provider: MessagingProvider["name"], eventId: string): string {
  return `${provider}_${eventId}`;
}
