// Lo que cobra Meta por mensaje cobrado, en dólares y sin IVA: el costo entre los mensajes de cada tipo que dio
// WhatsApp Manager › Precios de mensajes para oct-2026 (14.04/345, 0.58/69 y 29.47/2,571; factura del 1-nov, US$44.16).
// Meta NO le da el costo al CRM (11-nov-2026: «COST is not shown for businesses who bill through a partner»), así que el
// costo es lo que reporta Meta en MENSAJES × esta tarifa. Si Meta cambia sus precios, se cambian aquí.
// Archivo aparte y sin dependencias (20-nov-2026): también lo usa la barra del chat, que se pinta en el navegador
// (lib/inbox/window-bar.ts); rates.ts lo vuelve a exportar.
export const META_RATE_USD: Record<string, number> = { marketing: 0.040696, utility: 0.008406, service: 0.011463 };
