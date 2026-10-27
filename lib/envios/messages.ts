// Textos de las guías para el vendedor y para el cliente (docs/envios.md). Puro.
import type { ShipmentView } from "./store";

const CARRIER_NAMES: Readonly<Record<string, string>> = { paquetexpress: "Paquetexpress", estafeta: "Estafeta" };

export function carrierLabel(carrier: string): string {
  return CARRIER_NAMES[carrier.trim().toLowerCase()] ?? carrier;
}

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });

export function priceLabel(price: number | null): string {
  return price === null ? "" : money.format(price);
}

/**
 * El mensaje con el rastreo que el vendedor deja en el chat (FAQ 55: «generamos la guía y se la mandamos por
 * este chat cuando sale a ruta»). De usted, como el resto de los mensajes de Diluvium.
 */
export function trackingMessage(s: Pick<ShipmentView, "carrier" | "trackingNumber" | "trackUrl">): string {
  const lines = [`Le comparto su guía de ${carrierLabel(s.carrier)}: *${s.trackingNumber ?? ""}*`];
  if (s.trackUrl) lines.push(`Puede rastrear su pedido aquí: ${s.trackUrl}`);
  return lines.join("\n");
}
