// Subpestañas de la pestaña «Seguimientos» del menú (7-oct-2026, docs/opiniones.md).
// Es otra cosa que Agente IA › Seguimientos (los mensajes que escribe el Agente IA
// cuando un chat se queda parado): aquí va lo que sigue después de la compra.
export const SEGUIMIENTOS_SECTIONS = [{ id: "opinion", label: "Opinión" }] as const;

export type SeguimientosSection = (typeof SEGUIMIENTOS_SECTIONS)[number]["id"];

export const DEFAULT_SEGUIMIENTOS_SECTION: SeguimientosSection = "opinion";

export function parseSeguimientosSection(value: string | string[] | undefined): SeguimientosSection {
  const v = Array.isArray(value) ? value[0] : value;
  return SEGUIMIENTOS_SECTIONS.find((s) => s.id === v)?.id ?? DEFAULT_SEGUIMIENTOS_SECTION;
}
