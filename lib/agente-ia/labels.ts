// Textos del estado del Agente IA para la UI (Bandeja y panel del contacto).
// Puro y seguro para el cliente.
import type { AgentStateValue } from "./types";

// Por qué está pausado el agente ("" si está activo). Desde el 23-sep-2026 la
// única pausa es la de un vendedor (contestó o lo apagó a mano en el contacto);
// los otros estados solo existen en datos viejos.
export function pauseReason(s: { agentState: AgentStateValue; pausedUntil: string | null }): string {
  switch (s.agentState) {
    case "activo":
      return "";
    case "pausado_humano":
      return "un vendedor tomó la conversación";
    default:
      return "en pausa";
  }
}
