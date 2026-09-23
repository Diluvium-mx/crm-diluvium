// Etiquetas internas que el agente dejaba en el contacto hasta el 23-sep-2026
// ("pasar a humano", "revisión humana"). Ya no se agregan (ahora deja avisos en
// el hilo) y NUNCA se muestran al vendedor: la UI las filtra con isInternalAgentTag.
// Puro y seguro para el cliente.
export const INTERNAL_AGENT_TAGS: readonly string[] = ["pasar a humano", "revisión humana"];

export function isInternalAgentTag(tag: string): boolean {
  const t = tag.trim().toLowerCase();
  return INTERNAL_AGENT_TAGS.includes(t) || t === "revision humana";
}
