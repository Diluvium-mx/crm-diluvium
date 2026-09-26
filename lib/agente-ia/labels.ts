// Textos del estado del Agente IA para la UI (Bandeja y panel del contacto).
// Puro y seguro para el cliente.
import { returnLabel } from "./pause";
import type { AgentStateValue } from "./types";

// Hasta cuándo está pausado el agente ("" si está activo). Decisión del dueño
// (25-sep-2026): toda pausa es la misma, la ponga un vendedor al contestar (sin
// tiempo) o con "Pausar agente" (8/12/24 h, una hora exacta o indefinidamente); lo
// único que cambia es la hora de regreso. Los otros estados solo existen en datos viejos.
// Textos desde el 26-sep-2026: "Pausado" / "indefinidamente" / "Activar".
export function pauseReason(s: { agentState: AgentStateValue; pausedUntil: string | null }, now: Date = new Date()): string {
  switch (s.agentState) {
    case "activo":
      return "";
    case "pausado_humano":
      return s.pausedUntil ? `vuelve ${returnLabel(new Date(s.pausedUntil), now)}` : "indefinidamente";
    default:
      return "en pausa";
  }
}

// Estado corto del agente en una conversación: "Activo", "Pausado · vuelve hoy 22:30" o
// "Pausado indefinidamente".
export function agentStatusLabel(s: { agentState: AgentStateValue; pausedUntil: string | null }, now: Date = new Date()): string {
  if (s.agentState === "activo") return "Activo";
  const reason = pauseReason(s, now);
  return reason === "indefinidamente" ? "Pausado indefinidamente" : `Pausado · ${reason}`;
}
