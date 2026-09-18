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
 * perfil llegan a todos los endpoints. ZERNIO_ALLOWED_ACCOUNT_IDS (ids
 * separados por coma) dice qué cuentas acepta ESTE entorno; lo demás —p. ej.
 * el número REAL llegando a staging, con datos de clientes— se descarta sin
 * guardarse.
 *
 * Falla CERRADO: la variable es obligatoria en todos los entornos (también en
 * producción, con el accountId del número real). Sin ella el canal se
 * considera no configurado y el webhook responde 503 sin guardar nada.
 */
export function allowedAccountIds(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  const ids = (env.ZERNIO_ALLOWED_ACCOUNT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new MessagingNotConfiguredError(
      "ZERNIO_ALLOWED_ACCOUNT_IDS es obligatoria: lista de accountId de Zernio que acepta este entorno",
    );
  }
  return new Set(ids);
}

/** Único evento que se acepta sin cuenta: la prueba del webhook (no se guarda). */
export const WEBHOOK_TEST_EVENT = "webhook.test";

/**
 * ¿Se guarda este evento? Solo si trae una cuenta de la lista. Un evento sin
 * cuenta (o con ids de cuenta contradictorios, que readEnvelope deja sin
 * cuenta) se rechaza: no hay forma de saber si es del número real.
 */
export function isAccountAllowed(providerAccountId: string | undefined, allowed: ReadonlySet<string>): boolean {
  return providerAccountId !== undefined && allowed.has(providerAccountId);
}
