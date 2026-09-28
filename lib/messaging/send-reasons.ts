// Motivo de un envío que no llegó, en español claro para el vendedor (Bloque B,
// 28-sep-2026). Lo usan la burbuja fallida del chat, las tarjetas de envío y los
// avisos de workflows. Puro (sin base) para poder probarlo solo.
//
// Los códigos comunes de WhatsApp (Cloud API) se explican; cualquier otro sale
// como «WhatsApp no lo entregó (código N)». Los códigos propios del CRM (envío
// sin confirmar, aceptado sin guardar, límite de Zernio) ya traen su texto en
// español y se explican aquí también.
import { SEND_ACCEPTED, SEND_RATE_LIMITED, SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";

// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const WHATSAPP_REASONS: Record<string, string> = {
  // Ventana de 24 h cerrada (470 es el código viejo del mismo caso).
  "131047": "la ventana de 24 h está cerrada (el cliente no ha escrito en las últimas 24 h); solo se puede mandar una plantilla",
  "470": "la ventana de 24 h está cerrada (el cliente no ha escrito en las últimas 24 h); solo se puede mandar una plantilla",
  // El número no tiene WhatsApp, no aceptó las condiciones o tiene una versión vieja.
  "131026": "ese número no puede recibir mensajes de WhatsApp",
  // Archivo que WhatsApp no pudo subir/descargar del enlace del CRM.
  "131053": "WhatsApp no pudo subir el archivo",
  "131052": "WhatsApp no pudo subir el archivo",
  // Tipo de mensaje/archivo que WhatsApp no acepta.
  "131051": "WhatsApp no permite ese tipo de archivo",
};

// Rechazos del propio CRM (SendRejectedError, adaptador): su texto ya está en español.
const CRM_OWN_CODES = new Set([
  "not_found",
  "window_closed",
  "not_linked",
  "empty",
  "not_retryable",
  "channel_unavailable",
  "template_not_found",
  "template_not_approved",
  "template_unsupported",
  "template_params",
  "media_not_found",
  "storage_unavailable",
  "media_url_insegura",
]);

/** Motivo en palabras simples; `raw` es el texto guardado (respaldo para los códigos del CRM). */
export function plainSendReason(errorCode: string | null | undefined, raw?: string | null): string {
  const code = (errorCode ?? "").trim();
  if (CRM_OWN_CODES.has(code) && raw?.trim()) return raw.trim();
  if (code === SEND_ACCEPTED) {
    return "WhatsApp sí recibió el mensaje, pero el CRM no pudo guardar la confirmación de que le llegó al cliente";
  }
  if (code === SEND_UNCONFIRMED || code.startsWith(SEND_UNKNOWN)) {
    return "WhatsApp no confirmó si el mensaje le llegó al cliente";
  }
  if (code === SEND_RATE_LIMITED) return "WhatsApp pidió esperar y el envío no alcanzó a salir";
  // El código de WhatsApp puede venir solo ("131053") o dentro de otro texto.
  const numeric = /(?<!\d)(\d{3,6})(?!\d)/.exec(code)?.[1];
  if (numeric && WHATSAPP_REASONS[numeric]) return WHATSAPP_REASONS[numeric];
  if (!code) return raw?.trim() ? `WhatsApp no lo entregó (${raw.trim().slice(0, 120)})` : "WhatsApp no lo entregó";
  return `WhatsApp no lo entregó (código ${numeric ?? code})`;
}
