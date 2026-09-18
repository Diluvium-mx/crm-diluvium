// Proveedor activo de WhatsApp. Un solo punto donde se elige: para migrar a la
// Cloud API directa de Meta, se agrega su adaptador y se cambia aquí.
import type { MessagingProvider } from "./provider";
import { ZernioProvider } from "./zernio";

let cached: MessagingProvider | undefined;

export class MessagingNotConfiguredError extends Error {}

export function messagingProvider(): MessagingProvider {
  if (cached) return cached;
  const apiKey = process.env.ZERNIO_API_KEY;
  const webhookSecret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) {
    throw new MessagingNotConfiguredError(
      "ZERNIO_API_KEY y ZERNIO_WEBHOOK_SECRET son obligatorios para el canal de WhatsApp",
    );
  }
  cached = new ZernioProvider({ apiKey, webhookSecret, baseUrl: process.env.ZERNIO_BASE_URL });
  return cached;
}

/** Id de webhook_events: proveedor + id del evento (BullMQ no acepta ":" en jobId). */
export function webhookEventRowId(provider: MessagingProvider["name"], eventId: string): string {
  return `${provider}_${eventId}`;
}

/**
 * Zernio no permite limitar un webhook a ciertas cuentas: todas las del
 * perfil llegan a todos los endpoints. En staging, ZERNIO_ALLOWED_ACCOUNT_IDS
 * (ids separados por coma) hace que los eventos de otras cuentas —p. ej. el
 * número REAL, con datos de clientes— se descarten sin guardarse. Sin la
 * variable (producción) se aceptan todas. Un evento sin cuenta (webhook.test)
 * se acepta.
 */
export function isAccountAllowed(
  providerAccountId: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.ZERNIO_ALLOWED_ACCOUNT_IDS?.trim();
  if (!raw || !providerAccountId) return true;
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(providerAccountId);
}
