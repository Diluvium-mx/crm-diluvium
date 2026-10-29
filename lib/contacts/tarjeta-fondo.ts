// Fondo de la tarjeta del Embudo para los chats que no son clientes (29-oct-2026, regla del dueño): pura
// estética, fijo y sin interfaz. Un color y un patrón de íconos según lo que hacen (app/globals.css ›
// data-fondo, public/fondos/). Solo se ve cuando la tarjeta NO pide atención: el azul («por contestar») y
// el amarillo («el Agente IA necesita al vendedor») mandan y, al atenderse, vuelve el patrón.
// Por id del contacto (el teléfono no va al repo, que es público). docs/mapa-crm/3.3-embudo.md.
import type { FunnelTone } from "./funnel-tone";

export type TarjetaFondo = "paqueteria" | "costura" | "propio";

const FONDO_POR_CONTACTO: ReadonlyMap<string, TarjetaFondo> = new Map([
  // Chat propio del dueño, para pasarse mensajes (sin Agente IA, migración 0071).
  ["d3bc6189-89c8-4739-b29d-06d9b4b909c6", "propio"],
  // Paquetería: desde aquí se piden las recolecciones (sin Agente IA, migración 0072).
  ["74f1580f-eddf-4833-ba12-7493c5323170", "paqueteria"],
  // Proveedor de las fundas a la medida (sin Agente IA desde el 29-oct-2026, marcado en producción con OK).
  ["e5aeb75f-9c5c-4673-ae43-1ba54aec9227", "costura"],
]);

export function tarjetaFondo(contactId: string, tone: FunnelTone | undefined): TarjetaFondo | undefined {
  return tone ? undefined : FONDO_POR_CONTACTO.get(contactId);
}
