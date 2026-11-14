// Oferta del Buen Fin en el Agente IA (13-nov-2026, pedido del dueño; docs/agente-ia/2026-11-13-oferta-buen-fin.md).
// Aviso TEMPORAL del CRM que va en el [CONTEXTO DEL CRM] del último mensaje del cliente: esa parte no está en la
// caché, así que no toca el Goal ni las FAQs ni cuesta reescritura. La oferta vale del 13-nov 00:00 al 18-nov 23:59:59
// hora de Mazatlán (el dueño la alargó un día el 13-nov; las mismas fechas que el temporizador de la columna,
// buen-fin-countdown.tsx). Del 19-nov al 25-nov sale un segundo aviso, «ya terminó» (14-nov), para quien vuelva con el
// precio de oferta; después no se agrega nada y el Agente IA vuelve solo a lo de siempre. Se quita junto con la columna
// Buen Fin (ETAPAS_FUERA_DEL_AGENTE en lib/contacts/stages.ts). Puro: sin base ni servidor.

/** Empieza el 13-nov-2026 a las 00:00 de Mazatlán. */
export const BUEN_FIN_INICIO_MS = Date.parse("2026-11-13T00:00:00-07:00");
/** Termina al empezar el 19-nov-2026 (el 18 a las 23:59:59 todavía vale). */
export const BUEN_FIN_FIN_MS = Date.parse("2026-11-19T00:00:00-07:00");
/** El aviso «ya terminó» sale una semana: hasta que empieza el 26-nov-2026. */
export const BUEN_FIN_DESPUES_FIN_MS = Date.parse("2026-11-26T00:00:00-07:00");

/** Precio de oferta de la compuerta estándar (el mismo de la página web). */
export const BUEN_FIN_PRECIO = "$5,199";

// Reglas del dueño (13-nov): solo la cifra de oferta, nunca el precio normal ni cuánto se ahorra; las fechas una sola
// vez (si un workflow ya las dijo, ni esa) salvo que pregunte hasta cuándo; no presumir el descuento, solo si el
// cliente dice que es el mismo precio o que no cambia mucho, decirle con amabilidad que sí es considerable; no decir
// por su cuenta que la oferta es solo de la estándar; si pregunta por la hecha a la medida, la mini, los tapones o un
// repuesto, decirle con amabilidad que la oferta es de los tamaños estándar y eso sigue con su precio.
// 14-nov (dueño): el link de $5,199 ahora es a meses: con la oferta sí hay meses sin intereses con tarjeta de crédito,
// sin decir cuántos; la oferta también está en la página web ($5,199), Amazon y Mercado Libre (de esas dos, nunca su
// precio), y las menciona solo si el cliente pregunta dónde más comprar o duda de pagar por WhatsApp; si alguien que
// pagó antes pide la diferencia, un asesor lo revisa (aviso al vendedor, sin prometer). Con 2 o más compuertas no
// cambia nada: el total va a $5,199 cada una y el link de ese total lo manda el vendedor.
export const BUEN_FIN_OFERTA_LINE = `OFERTA BUEN FIN (aviso temporal del CRM; manda sobre lo que diga el Goal del precio de la compuerta estándar, de los meses sin intereses y de los descuentos): la compuerta estándar está en ${BUEN_FIN_PRECIO} con envío gratis. Di siempre solo esa cifra: nunca menciones, compares ni recuerdes el precio normal o anterior, ni digas cuánto se ahorra. La primera vez que des el precio en este chat, dilo como oferta por el Buen Fin, del 13 al 18 de noviembre; si en el chat ya se dijo (por ejemplo, en un mensaje automático), no repitas las fechas aunque vuelvas a dar el precio o un total, y después no las vuelvas a mencionar salvo que el cliente pregunte hasta cuándo. Solo si pregunta si puede pagar después o apartar, dile que el precio vale pagando a más tardar el 18 de noviembre; no ofrezcas apartados ni prometas el precio después de esa fecha. No presumas el descuento (nada de «gran descuento», «súper precio» ni «aprovéchelo antes de que suba»); solo si el cliente dice que es el mismo precio o que no cambia mucho, contéstale con amabilidad que sí es un descuento considerable por el Buen Fin, sin dar el precio normal. Si pide descuento o dice que se le hace caro, dile que ese ya es el precio de oferta del Buen Fin y que no manejamos otro descuento (no digas «no manejamos descuentos»). Si pregunta cuánto costaba antes o si es el precio normal, no digas que no puedes decirlo: contéstale solo que ahorita está en ${BUEN_FIN_PRECIO} por la oferta del Buen Fin. En los totales y en fijar_cotizacion usa ${BUEN_FIN_PRECIO} por compuerta estándar (si un vendedor ya fijó la cotización, esa manda). Con el precio de oferta la compuerta estándar sí se puede pagar a meses sin intereses con tarjeta de crédito (con el link de pago de ${BUEN_FIN_PRECIO}, o de contado con crédito o débito): cuando hables de meses, di solo que puede pagarla a meses sin intereses con tarjeta de crédito, sin decir cuántos meses, aunque el Goal o la lista de links digan un número. La oferta del Buen Fin también está en nuestra página web, en ${BUEN_FIN_PRECIO}, y en Amazon y Mercado Libre: de Amazon y Mercado Libre di solo que también tienen la compuerta en oferta, nunca su precio. Menciona esas tiendas solo si el cliente pregunta dónde más puede comprarla o por alguna de ellas, o si duda de pagar por WhatsApp (desconfía o teme un fraude): entonces, con calma y sin presionar, dile que también puede comprarla con la oferta en nuestra página web, en Amazon o en Mercado Libre, por donde se sienta más seguro. No digas por tu cuenta que la oferta es solo para las estándar (ni «en los tamaños estándar» si no te lo preguntan). Si pregunta si la compuerta hecha a la medida, la mini, los tapones inflables o un repuesto (funda, tira de hule) tiene la oferta, dile con amabilidad que la oferta del Buen Fin es para los tamaños estándar y que eso sigue con su precio de siempre (la hecha a la medida se paga como siempre: anticipo y el resto cuando esté fabricada). Si un cliente que ya compró antes del 13 de noviembre pide que le regresen la diferencia, dile con amabilidad que un asesor lo revisa con él, avisa al vendedor con aviso_vendedor motivo cliente_pide_humano (en el detalle: pide la diferencia del Buen Fin) y no prometas nada.`;

// 14-nov (dueño): del 19 al 25 de noviembre, si en el chat se dio el precio de oferta y el cliente vuelve a pagar, se le
// dice con amabilidad que terminó el 18, se le da el precio de siempre y se avisa al vendedor por si se le respeta.
export const BUEN_FIN_TERMINO_LINE = `FIN DEL BUEN FIN (aviso temporal del CRM; manda sobre lo que se haya dicho antes en este chat): la oferta del Buen Fin terminó el 18 de noviembre y la compuerta estándar volvió a su precio de siempre, el que dice el Goal; ya no uses ${BUEN_FIN_PRECIO} en precios, totales ni fijar_cotizacion (si un vendedor ya fijó la cotización, esa manda). Si en este chat se le dio el precio de oferta y ahora quiere pagar o pregunta por ese precio, dile con amabilidad que la oferta del Buen Fin terminó el 18 de noviembre, dale el precio de siempre y avisa al vendedor con aviso_vendedor motivo cliente_pide_humano (en el detalle: se le dio el precio del Buen Fin y quiere pagar después del 18) por si se le respeta; no prometas que se le respeta. Si en este chat no se habló de la oferta, no la menciones.`;

/**
 * El aviso que toca a esa hora: la oferta del 13 al 18 de noviembre, «ya terminó» del 19 al 25, y null fuera de esas
 * fechas (no se agrega nada al contexto).
 */
export function buenFinOfertaLine(now: Date): string | null {
  const t = now.getTime();
  if (t >= BUEN_FIN_INICIO_MS && t < BUEN_FIN_FIN_MS) return BUEN_FIN_OFERTA_LINE;
  if (t >= BUEN_FIN_FIN_MS && t < BUEN_FIN_DESPUES_FIN_MS) return BUEN_FIN_TERMINO_LINE;
  return null;
}
