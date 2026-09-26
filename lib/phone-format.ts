// Presentación de teléfonos en la UI (cliente): "+52 668 242 6364", sin bandera
// (decisión del dueño, 25-sep-2026: junto al número solo va la ciudad por lada).
// Usa la metadata "min" de libphonenumber-js (formatos de todos los países, más
// liviana que "max"); la validación vive en lib/phone.ts (servidor).
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** Formato internacional legible; si no se reconoce, el valor tal cual. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/**
 * ¿El teléfono coincide con lo que se teclea? Compara solo dígitos: acepta los
 * 10 dígitos solos, con 52 / +52 delante, con espacios o guiones, y el 521
 * heredado de WhatsApp (se busca como 52 + 10).
 */
export function phoneMatchesSearch(e164: string | null | undefined, term: string): boolean {
  if (!e164) return false;
  const digits = term.replace(/\D/g, "");
  if (digits.length < 3) return false;
  const stored = e164.replace(/\D/g, "");
  const legacy = digits.match(/^521(\d{10})$/);
  return stored.includes(digits) || (legacy !== null && stored.endsWith(legacy[1]));
}
