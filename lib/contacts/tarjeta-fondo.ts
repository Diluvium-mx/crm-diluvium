// Fondo de la tarjeta del Embudo para los chats que no son clientes (29-oct-2026, regla del dueño): pura
// estética, fijo y sin interfaz. Un color con un patrón de íconos según lo que hacen, o una foto (app/globals.css ›
// data-fondo, public/fondos/). Nunca se tapa (9-nov-2026, regla del dueño): si la tarjeta pide atención, el azul
// («por contestar») o el amarillo («el Agente IA necesita al vendedor») salen solo como contorno alrededor.
// Por id del contacto (el teléfono no va al repo, que es público). docs/mapa-crm/3.3-embudo.md.

export type TarjetaFondo = "paqueteria" | "estafeta" | "envia" | "acero" | "costura" | "propio" | "foto";

const FONDO_POR_CONTACTO: ReadonlyMap<string, TarjetaFondo> = new Map([
  // Chat propio del dueño, para pasarse mensajes (sin Agente IA, migración 0071).
  ["d3bc6189-89c8-4739-b29d-06d9b4b909c6", "propio"],
  // Paquetería: desde aquí se piden las recolecciones (sin Agente IA, migración 0072).
  ["74f1580f-eddf-4833-ba12-7493c5323170", "paqueteria"],
  // Estafeta: avisos de los envíos en plantillas que WhatsApp no deja ver (sin Agente IA desde el 14-nov-2026,
  // marcado en producción con OK).
  ["23fcc0c0-a453-4383-a2f8-a891dc2ce78c", "estafeta"],
  // Envía (plataforma de las guías) y Kalisch Acero (proveedor de acero): avisos que WhatsApp no deja ver (sin Agente
  // IA desde el 17-nov-2026, marcados en producción con OK).
  ["731c271c-1cb6-48cf-adc7-095d2db855dd", "envia"],
  ["2f6845b1-a5ec-48e3-81da-94b4f7e5393b", "acero"],
  // Proveedor de las fundas a la medida (sin Agente IA desde el 29-oct-2026, marcado en producción con OK).
  ["e5aeb75f-9c5c-4673-ae43-1ba54aec9227", "costura"],
  // Contacto con su foto de fondo (sin Agente IA desde el 9-nov-2026, pedido por el dueño).
  ["d87bc548-54bd-4236-a0ec-854791cc7702", "foto"],
]);

export function tarjetaFondo(contactId: string): TarjetaFondo | undefined {
  return FONDO_POR_CONTACTO.get(contactId);
}
