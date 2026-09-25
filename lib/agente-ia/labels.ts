// Textos del estado del Agente IA para la UI (Bandeja y panel del contacto).
// Puro y seguro para el cliente.
import { returnLabel } from "./pause";
import type { AgentStateValue } from "./types";

// Hasta cuándo está apagado el bot ("" si está activo). Decisión del dueño
// (25-sep-2026): toda pausa es "bot apagado", la ponga un vendedor al contestar
// (sin tiempo) o con el botón "Apagar bot" (8/12/24 h, una hora exacta o sin
// tiempo); lo único que cambia es la hora de regreso. Los otros estados solo
// existen en datos viejos.
export function pauseReason(s: { agentState: AgentStateValue; pausedUntil: string | null }, now: Date = new Date()): string {
  switch (s.agentState) {
    case "activo":
      return "";
    case "pausado_humano":
      return s.pausedUntil ? `vuelve ${returnLabel(new Date(s.pausedUntil), now)}` : "hasta que lo reactives";
    default:
      return "en pausa";
  }
}
