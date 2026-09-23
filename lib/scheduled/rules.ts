// Reglas puras de los mensajes programados (A6): hora local de Mazatlán ↔
// instante UTC, límites de fecha y si la ventana de 24 h seguirá abierta a la
// hora de envío. Sin base de datos, para testearlas solas.
import { isWindowOpen } from "@/lib/messaging/rules";

export const SCHEDULE_TIME_ZONE = "America/Mazatlan";
/** Mínimo de anticipación: menos que esto es "enviar ahora". */
export const MIN_LEAD_MS = 60_000;
/** Máximo: 60 días. Más allá, el contexto de la conversación ya cambió. */
export const MAX_LEAD_MS = 60 * 24 * 60 * 60 * 1000;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// Desfase (ms) de la zona respecto a UTC en un instante dado. Mazatlán es UTC-7
// fijo desde 2022, pero se calcula con Intl para no depender de eso.
function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * "2026-09-23T10:00" (hora local de Mazatlán, como la da un
 * <input type="datetime-local">) → instante UTC. null si el texto no es una
 * fecha/hora válida.
 */
export function localToInstant(local: string): Date | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) {
    return null;
  }
  // Primer ajuste con el desfase en ese momento; se recalcula por si cae
  // justo en un cambio de horario (no aplica hoy a Mazatlán).
  const first = new Date(naive - zoneOffsetMs(new Date(naive)));
  return new Date(naive - zoneOffsetMs(first));
}

/** Instante → "2026-09-23T10:00" en hora de Mazatlán (para prellenar el input). */
export function instantToLocal(instant: Date): string {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant));
  return shifted.toISOString().slice(0, 16);
}

export type SendAtError = "invalid" | "too_soon" | "too_far";

export function validateSendAt(sendAt: Date | null, now: Date = new Date()): SendAtError | null {
  if (!sendAt || Number.isNaN(sendAt.getTime())) return "invalid";
  const lead = sendAt.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) return "too_soon";
  if (lead > MAX_LEAD_MS) return "too_far";
  return null;
}

export const SEND_AT_MESSAGES: Record<SendAtError, string> = {
  invalid: "Elige una fecha y hora válidas.",
  too_soon: "La hora debe ser al menos 1 minuto en el futuro.",
  too_far: "Solo se puede programar hasta 60 días adelante.",
};

/**
 * ¿Se puede programar TEXTO libre para esa hora? Solo si la ventana de 24 h
 * seguirá abierta entonces. Si el cliente escribe antes, la ventana se renueva,
 * pero al programar no se puede contar con eso: fuera de ventana → plantilla.
 */
export function textAllowedAt(windowExpiresAt: Date | null, sendAt: Date): boolean {
  return isWindowOpen(windowExpiresAt, sendAt);
}

/**
 * Fallas de un programado que se pueden REINTENTAR desde el CRM: solo las que
 * ocurren ANTES de llamar al proveedor (seguro no salió): validaciones del envío,
 * canal no configurado o el disparo tardío. Todo lo demás —rechazo de WhatsApp
 * (se reintenta desde su burbuja), error inesperado o envío interrumpido— puede
 * haber salido: reintentar crearía otro mensaje con otra clave de idempotencia y
 * el cliente lo recibiría dos veces. Ahí el vendedor revisa el chat y, si no
 * llegó, lo programa de nuevo.
 */
const RETRYABLE_ERROR_CODES = new Set([
  "late",
  "not_configured",
  "not_found",
  "window_closed",
  "not_linked",
  "empty",
  "channel_unavailable",
  "template_not_found",
  "template_not_approved",
  "template_unsupported",
  "template_params",
]);

export function isRetryableScheduledError(errorCode: string | null): boolean {
  return errorCode !== null && RETRYABLE_ERROR_CODES.has(errorCode);
}
