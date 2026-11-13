// Oferta del Buen Fin en el Agente IA (13-nov-2026, pedido del dueño; docs/agente-ia/2026-11-13-oferta-buen-fin.md).
// Aviso TEMPORAL del CRM que va en el [CONTEXTO DEL CRM] del último mensaje del cliente: esa parte no está en la
// caché, así que no toca el Goal ni las FAQs ni cuesta reescritura. Solo existe del 13-nov 00:00 al 17-nov 23:59:59
// hora de Mazatlán (las mismas fechas que el temporizador de la columna, buen-fin-countdown.tsx); fuera de ellas no
// se agrega nada y el Agente IA vuelve solo a lo de siempre. Se quita junto con la columna Buen Fin
// (ETAPAS_FUERA_DEL_AGENTE en lib/contacts/stages.ts). Puro: sin base ni servidor.

/** Empieza el 13-nov-2026 a las 00:00 de Mazatlán. */
export const BUEN_FIN_INICIO_MS = Date.parse("2026-11-13T00:00:00-07:00");
/** Termina al empezar el 18-nov-2026 (el 17 a las 23:59:59 todavía vale). */
export const BUEN_FIN_FIN_MS = Date.parse("2026-11-18T00:00:00-07:00");

/** Precio de oferta de la compuerta estándar (el mismo de la página web). */
export const BUEN_FIN_PRECIO = "$5,199";

// Reglas del dueño (13-nov): el Agente IA dice siempre solo la cifra de oferta, nunca recuerda ni compara con el
// precio normal; las fechas van una sola vez (si un workflow ya las dijo, ni esa); la oferta es solo de la compuerta
// estándar, pero el Agente IA no lo dice; la hecha a la medida y la mini siguen igual y con ellas no se menciona.
export const BUEN_FIN_OFERTA_LINE = `OFERTA BUEN FIN (aviso temporal del CRM; manda sobre lo que diga el Goal del precio de la compuerta estándar y de los descuentos): la compuerta estándar está en ${BUEN_FIN_PRECIO} con envío gratis. Di siempre solo esa cifra: nunca menciones, compares ni recuerdes el precio normal. La primera vez que des el precio en este chat, dilo como oferta por el Buen Fin, del 13 al 17 de noviembre; si en el chat ya se dijo (por ejemplo, en un mensaje automático), no lo repitas, y después no vuelvas a mencionar las fechas. Si pide descuento o dice que se le hace caro, ese ya es el precio de oferta: no ofrezcas otro descuento. En los totales y en fijar_cotizacion usa ${BUEN_FIN_PRECIO} por compuerta estándar (si un vendedor ya fijó la cotización, esa manda); para pagar con tarjeta una compuerta estándar, usa el link de pago de ${BUEN_FIN_PRECIO}. No digas que la oferta es solo para las estándar: las hechas a la medida y las mini siguen con su precio y con ellas no menciones la oferta.`;

/** El aviso si `now` cae dentro del Buen Fin; si no, null (no se agrega nada al contexto). */
export function buenFinOfertaLine(now: Date): string | null {
  const t = now.getTime();
  return t >= BUEN_FIN_INICIO_MS && t < BUEN_FIN_FIN_MS ? BUEN_FIN_OFERTA_LINE : null;
}
