// Oferta del Buen Fin en el Agente IA (13-nov-2026, pedido del dueño; docs/agente-ia/2026-11-13-oferta-buen-fin.md).
// Aviso TEMPORAL del CRM que va en el [CONTEXTO DEL CRM] del último mensaje del cliente: esa parte no está en la
// caché, así que no toca el Goal ni las FAQs ni cuesta reescritura. Solo existe del 13-nov 00:00 al 18-nov 23:59:59
// hora de Mazatlán (el dueño la alargó un día el 13-nov; las mismas fechas que el temporizador de la columna,
// buen-fin-countdown.tsx); fuera de ellas no se agrega nada y el Agente IA vuelve solo a lo de siempre. Se quita junto
// con la columna Buen Fin (ETAPAS_FUERA_DEL_AGENTE en lib/contacts/stages.ts). Puro: sin base ni servidor.

/** Empieza el 13-nov-2026 a las 00:00 de Mazatlán. */
export const BUEN_FIN_INICIO_MS = Date.parse("2026-11-13T00:00:00-07:00");
/** Termina al empezar el 19-nov-2026 (el 18 a las 23:59:59 todavía vale). */
export const BUEN_FIN_FIN_MS = Date.parse("2026-11-19T00:00:00-07:00");

/** Precio de oferta de la compuerta estándar (el mismo de la página web). */
export const BUEN_FIN_PRECIO = "$5,199";

// Reglas del dueño (13-nov): solo la cifra de oferta, nunca el precio normal ni cuánto se ahorra; las fechas una sola
// vez (si un workflow ya las dijo, ni esa) salvo que pregunte hasta cuándo; no presumir el descuento, solo si el
// cliente dice que es el mismo precio o que no cambia mucho, decirle con amabilidad que sí es considerable; no decir
// por su cuenta que la oferta es solo de la estándar; si pregunta por la hecha a la medida, la mini o un repuesto,
// decirle con amabilidad que la oferta es de los tamaños estándar y eso sigue con su precio. Tras las pruebas del
// 13-nov: con la oferta la tarjeta es de contado (el link de $5,199 no es a meses), así que no ofrece meses sin intereses
// en la estándar; la página web y Amazon también tienen la oferta (Mercado Libre todavía no: ahí contesta como siempre).
export const BUEN_FIN_OFERTA_LINE = `OFERTA BUEN FIN (aviso temporal del CRM; manda sobre lo que diga el Goal del precio de la compuerta estándar y de los descuentos): la compuerta estándar está en ${BUEN_FIN_PRECIO} con envío gratis. Di siempre solo esa cifra: nunca menciones, compares ni recuerdes el precio normal o anterior, ni digas cuánto se ahorra. La primera vez que des el precio en este chat, dilo como oferta por el Buen Fin, del 13 al 18 de noviembre; si en el chat ya se dijo (por ejemplo, en un mensaje automático), no repitas las fechas aunque vuelvas a dar el precio o un total, y después no las vuelvas a mencionar salvo que el cliente pregunte hasta cuándo. Solo si pregunta si puede pagar después o apartar, dile que el precio vale pagando a más tardar el 18 de noviembre; no ofrezcas apartados ni prometas el precio después de esa fecha. No presumas el descuento (nada de «gran descuento», «súper precio» ni «aprovéchelo antes de que suba»); solo si el cliente dice que es el mismo precio o que no cambia mucho, contéstale con amabilidad que sí es un descuento considerable por el Buen Fin, sin dar el precio normal. Si pide descuento o dice que se le hace caro, dile que ese ya es el precio de oferta del Buen Fin y que no manejamos otro descuento (no digas «no manejamos descuentos»). Si pregunta cuánto costaba antes o si es el precio normal, no digas que no puedes decirlo: contéstale solo que ahorita está en ${BUEN_FIN_PRECIO} por la oferta del Buen Fin. En los totales y en fijar_cotizacion usa ${BUEN_FIN_PRECIO} por compuerta estándar (si un vendedor ya fijó la cotización, esa manda); con el precio de oferta, el pago con tarjeta de la compuerta estándar es de contado (crédito o débito) con el link de pago de ${BUEN_FIN_PRECIO}: no ofrezcas meses sin intereses en la compuerta estándar y, si pregunta por meses, dile con amabilidad que el precio de oferta es de contado. En la página web también está en ${BUEN_FIN_PRECIO} y en Amazon también hay oferta del Buen Fin (no digas el precio de Amazon); no menciones otras plataformas por tu cuenta. No digas por tu cuenta que la oferta es solo para las estándar (ni «en los tamaños estándar» si no te lo preguntan). Si pregunta si la compuerta hecha a la medida, la mini o un repuesto (funda, tira de hule) tiene la oferta, dile con amabilidad que la oferta del Buen Fin es para los tamaños estándar y que eso sigue con su precio de siempre (la hecha a la medida se paga como siempre: anticipo y el resto cuando esté fabricada).`;

/** El aviso si `now` cae dentro del Buen Fin; si no, null (no se agrega nada al contexto). */
export function buenFinOfertaLine(now: Date): string | null {
  const t = now.getTime();
  return t >= BUEN_FIN_INICIO_MS && t < BUEN_FIN_FIN_MS ? BUEN_FIN_OFERTA_LINE : null;
}
