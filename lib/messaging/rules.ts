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

/**
 * Los estados pueden llegar desordenados (reintentos): nunca se retrocede
 * (un "delivered" tardío no pisa un "read"). "failed" gana siempre, salvo
 * que el mensaje ya se haya leído (entonces el fallo es de un reintento).
 */
export function nextStatus(current: Status, incoming: Status): Status {
  if (incoming === "failed") return current === "read" ? current : "failed";
  if (current === "failed") return current;
  return RANK[incoming] > RANK[current] ? incoming : current;
}

// Códigos de un envío del CRM de resultado ambiguo (lib/messaging/send.ts).
export const SEND_UNKNOWN = "send_unknown";
export const SEND_UNCONFIRMED = "send_unconfirmed";

/**
 * ¿El fallo de este envío es AMBIGUO (no se sabe si llegó al cliente)?
 * Zernio solo guarda respuestas 2xx para la clave de idempotencia y la libera
 * cuando su API responde error o corta; reintentar un ambiguo con la misma
 * clave puede mandar el mensaje DOS veces. Por eso un ambiguo nunca se
 * reintenta desde el CRM. Un rechazo definitivo (4xx: no salió) sí.
 */
export function isAmbiguousSendError(errorCode: string | null | undefined): boolean {
  return errorCode === SEND_UNCONFIRMED || (errorCode?.startsWith(SEND_UNKNOWN) ?? false);
}
