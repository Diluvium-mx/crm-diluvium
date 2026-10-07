// Subpestañas de la pestaña Agente IA (27-sep-2026; antes «Crear | Implementar»). PURO y
// seguro para el cliente: lo usan la página (lee ?seccion= de la URL) y el editor.
export const AGENT_SECTIONS = [
  { id: "modelos", label: "Modelos" },
  // Columnas del Embudo (26-sep-2026): nombre, orden, color, papel, regla del bot y modelo.
  { id: "etapas", label: "Etapas" },
  { id: "goal", label: "Instrucciones (Goal)" },
  { id: "faqs", label: "FAQs" },
  { id: "opciones", label: "Opciones" },
  // Tabla de los seguimientos del Agente IA (Parte 4, 6-oct-2026).
  { id: "seguimientos", label: "Seguimientos" },
  { id: "tallas", label: "Tallas y medidas" },
  { id: "canales", label: "Canales" },
  // Historial de cambios (Bloque A, 28-sep-2026): quién cambió qué y cuándo.
  { id: "historial", label: "Historial" },
] as const;

export type AgentSection = (typeof AGENT_SECTIONS)[number]["id"];

export const DEFAULT_AGENT_SECTION: AgentSection = "modelos";

/** `?seccion=` de la URL → subpestaña; cualquier otra cosa (o nada) = «Modelos». */
export function parseAgentSection(value: string | string[] | undefined): AgentSection {
  const v = Array.isArray(value) ? value[0] : value;
  return AGENT_SECTIONS.find((s) => s.id === v)?.id ?? DEFAULT_AGENT_SECTION;
}
