// Textos de las guías para el vendedor y para el cliente (docs/envios.md). Puro.
import type { ShipmentView } from "./store";

const CARRIER_NAMES: Readonly<Record<string, string>> = { paquetexpress: "Paquetexpress", estafeta: "Estafeta" };

export function carrierLabel(carrier: string): string {
  return CARRIER_NAMES[carrier.trim().toLowerCase()] ?? carrier;
}

/**
 * El nombre del servicio sin la paquetería repetida («Paquetexpress Standard» → «Standard»; «Estafeta Terrestre
 * Ocurre - Domicilio» → «Terrestre Ocurre - Domicilio»).
 */
export function serviceName(carrier: string, label: string | null): string {
  const name = carrierLabel(carrier);
  const text = (label ?? "").trim();
  const rest = text.toLowerCase().startsWith(name.toLowerCase()) ? text.slice(name.length).trim() : text;
  return rest || text;
}

// Cuenta real (27-oct-2026): cada paquetería cotiza su servicio a domicilio («ground», «express») y las variantes
// «Ocurre» de Envia: «_od» = se deja en sucursal y llega a domicilio; «_do» = sale de domicilio y el cliente la
// recoge en sucursal.
export function isDoorToDoor(service: string): boolean {
  return !/_(od|do)$/i.test(service.trim());
}

export function serviceHint(service: string): string {
  const s = service.trim().toLowerCase();
  if (s.endsWith("_od")) return "se deja en sucursal; llega a domicilio";
  if (s.endsWith("_do")) return "el cliente la recoge en sucursal";
  return "a domicilio";
}

/** Paquetería preferida (regla del dueño, 27-oct-2026): Paquetexpress puerta a puerta; recoge en la oficina y entrega a domicilio. */
export const PREFERRED_CARRIER = "paquetexpress";

type OptionLike = { carrier: string; service: string; extendedFare: number };

/** ¿Es la opción de siempre? Paquetexpress, puerta a puerta y sin zona extendida. */
export function isPreferred(o: OptionLike): boolean {
  return o.carrier.trim().toLowerCase() === PREFERRED_CARRIER && isDoorToDoor(o.service) && o.extendedFare <= 0;
}

/**
 * La que viene marcada: Paquetexpress puerta a puerta aunque cueste unos pesos más (la más barata de esas);
 * si no hay, la más barata puerta a puerta; si no, la primera. Las opciones vienen de la más barata a la más cara.
 */
export function preferredOptionIndex(options: readonly OptionLike[]): number {
  const preferred = options.findIndex((o) => o.carrier.trim().toLowerCase() === PREFERRED_CARRIER && isDoorToDoor(o.service));
  if (preferred >= 0) return preferred;
  const door = options.findIndex((o) => isDoorToDoor(o.service));
  return door >= 0 ? door : 0;
}

/** Por qué la opción marcada necesita que un vendedor la revise (zona extendida o no es la paquetería de siempre), o null. */
export function reviewReason(options: readonly OptionLike[]): string | null {
  if (options.length === 0) return "Ninguna paquetería dio precio para este destino.";
  const chosen = options[preferredOptionIndex(options)]!;
  if (chosen.carrier.trim().toLowerCase() !== PREFERRED_CARRIER) return "Paquetexpress no llega a este código postal: hay que elegir otra paquetería.";
  if (chosen.extendedFare > 0) return "Es zona extendida: hay que elegir la paquetería.";
  if (!isDoorToDoor(chosen.service)) return "Paquetexpress no da servicio puerta a puerta a este destino.";
  return null;
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
