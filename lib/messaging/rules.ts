// Reglas puras del canal (sin base de datos), para poder testearlas solas.

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** La ventana de 24 h se abre/renueva con cada mensaje ENTRANTE del contacto. */
export function windowExpiresAt(inboundSentAt: Date, current: Date | null): Date {
  const candidate = new Date(inboundSentAt.getTime() + SERVICE_WINDOW_MS);
  return current && current > candidate ? current : candidate;
}

export function isWindowOpen(windowExpires: Date | null, now = new Date()): boolean {
  return windowExpires !== null && windowExpires > now;
}

// ─── Instagram (docs/instagram.md) ─────────────────────────────────────────
// Misma ventana de 24 h que WhatsApp (la abre cada mensaje del cliente), pero sin
// plantillas: de 24 h a 7 días desde el último mensaje del cliente SOLO un vendedor puede
// contestar, con la etiqueta HUMAN_AGENT de Meta (ni el Agente IA ni las automatizaciones);
// después, nada hasta que el cliente vuelva a escribir.
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Fin de los 7 días de un vendedor en Instagram (`window_expires_at` = último entrante + 24 h). */
export function humanAgentExpiresAt(windowExpires: Date | null): Date | null {
  return windowExpires && new Date(windowExpires.getTime() - SERVICE_WINDOW_MS + HUMAN_AGENT_WINDOW_MS);
}

/**
 * ¿Se puede mandar texto libre o un archivo? WhatsApp: solo dentro de 24 h (fuera,
 * plantilla). Instagram: dentro de 24 h cualquiera; hasta 7 días, solo si lo manda una
 * persona (`human`).
 */
export function canSendFreeForm(platform: string, windowExpires: Date | null, now: Date, human: boolean): boolean {
  if (isWindowOpen(windowExpires, now)) return true;
  return platform === "instagram" && human && isWindowOpen(humanAgentExpiresAt(windowExpires), now);
}

/** Instagram fuera de las 24 h: el envío (de una persona) va con la etiqueta HUMAN_AGENT. */
export function needsHumanAgentTag(platform: string, windowExpires: Date | null, now: Date): boolean {
  return platform === "instagram" && !isWindowOpen(windowExpires, now);
}

/** Marca en `messages.metadata` con los ids de las otras partes de un envío de Instagram. */
export const INSTAGRAM_PARTS_META = "partesInstagram";
/** Marca en `messages.metadata` con el aviso de un envío que salió incompleto. */
export const SEND_WARNING_META = "avisoEnvio";

/**
 * Tiempo de primera respuesta (CLAUDE.md §5: se calcula UNA vez, al primer
 * saliente humano). Cuenta la respuesta desde el CRM y también desde la app
 * del celular (coexistencia): ambas son de un vendedor.
 */
export function firstResponseSeconds(firstInboundAt: Date | null, replyAt: Date): number | null {
  if (!firstInboundAt || replyAt < firstInboundAt) return null;
  return Math.round((replyAt.getTime() - firstInboundAt.getTime()) / 1000);
}

type Status = "queued" | "sent" | "delivered" | "read" | "failed" | "received";
const RANK: Record<Status, number> = { queued: 0, sent: 1, delivered: 2, read: 3, received: 3, failed: 4 };

/** "Entregado" o "leído": prueba de que el mensaje le llegó al cliente. */
export function isDeliveredStatus(status: Status): boolean {
  return status === "delivered" || status === "read";
}

/**
 * Los estados pueden llegar desordenados (reintentos): nunca se retrocede
 * (un "delivered" tardío no pisa un "read"). "Entregado" o "leído" es PRUEBA de
 * que el mensaje llegó: gana siempre sobre "failed", llegue antes o después
 * (el fallo era de un reintento; Bloque B, 28-sep-2026). Un "failed" sin esa
 * prueba gana sobre "queued"/"sent" y queda visible.
 */
export function nextStatus(current: Status, incoming: Status): Status {
  if (incoming === "failed") return isDeliveredStatus(current) ? current : "failed";
  if (current === "failed") return isDeliveredStatus(incoming) ? incoming : current;
  return RANK[incoming] > RANK[current] ? incoming : current;
}

// Códigos de un envío del CRM de resultado ambiguo (lib/messaging/send.ts).
export const SEND_UNKNOWN = "send_unknown";
export const SEND_UNCONFIRMED = "send_unconfirmed";
// Zernio ACEPTÓ el envío (2xx) y después falló la base al guardar la confirmación:
// el mensaje casi seguro salió. Nunca se reenvía solo (Bloque B, 28-sep-2026).
export const SEND_ACCEPTED = "send_accepted";
// Zernio pidió esperar (429) y el envío no se completó: NO salió (429 = no lo
// procesó), así que sí se puede reintentar.
export const SEND_RATE_LIMITED = "rate_limited";

/**
 * ¿El fallo de este envío es AMBIGUO (no se sabe si llegó al cliente)?
 * Zernio solo guarda respuestas 2xx para la clave de idempotencia y la libera
 * cuando su API responde error o corta; reintentar un ambiguo con la misma
 * clave puede mandar el mensaje DOS veces. Por eso un ambiguo nunca se
 * reintenta desde el CRM. Un rechazo definitivo (4xx: no salió) sí.
 */
export function isAmbiguousSendError(errorCode: string | null | undefined): boolean {
  return errorCode === SEND_UNCONFIRMED || errorCode === SEND_ACCEPTED || (errorCode?.startsWith(SEND_UNKNOWN) ?? false);
}
