// Fondo de la tarjeta del Embudo para los chats que no son clientes (29-oct-2026, regla del dueño): pura
// estética, fijo y sin interfaz. Un color con un patrón de íconos según lo que hacen, o una foto (app/globals.css ›
// data-fondo, public/fondos/). Nunca se tapa (9-nov-2026, regla del dueño): si la tarjeta pide atención, el azul
// («por contestar») o el amarillo («el Agente IA necesita al vendedor») salen solo como contorno alrededor.
// Por id del contacto (el teléfono no va al repo, que es público). docs/mapa-crm/3.3-embudo.md.

export type TarjetaFondo = "paqueteria" | "costura" | "propio" | "foto";

const FONDO_POR_CONTACTO: ReadonlyMap<string, TarjetaFondo> = new Map([
  // Chat propio del dueño, para pasarse mensajes (sin Agente IA, migración 0071).
  ["d3bc6189-89c8-4739-b29d-06d9b4b909c6", "propio"],
  // Paquetería: desde aquí se piden las recolecciones (sin Agente IA, migración 0072).
  ["74f1580f-eddf-4833-ba12-7493c5323170", "paqueteria"],
  // Proveedor de las fundas a la medida (sin Agente IA desde el 29-oct-2026, marcado en producción con OK).
  ["e5aeb75f-9c5c-4673-ae43-1ba54aec9227", "costura"],
  // Contacto con su foto de fondo (sin Agente IA desde el 9-nov-2026, pedido por el dueño).
  ["d87bc548-54bd-4236-a0ec-854791cc7702", "foto"],
]);

export function tarjetaFondo(contactId: string): TarjetaFondo | undefined {
  return FONDO_POR_CONTACTO.get(contactId);
}
