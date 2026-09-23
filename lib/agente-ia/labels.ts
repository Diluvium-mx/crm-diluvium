// Textos del estado del Agente IA para la UI (Bandeja y panel del contacto).
// Puro y seguro para el cliente.
import { SCHEDULE_TIME_ZONE } from "@/lib/scheduled/rules";
import type { AgentStateValue } from "./types";

const timeFormat = new Intl.DateTimeFormat("es-MX", {
  timeZone: SCHEDULE_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// Por qué está pausado el agente ("" si está activo).
export function pauseReason(s: { agentState: AgentStateValue; pausedUntil: string | null }): string {
  switch (s.agentState) {
    case "pausado_humano":
      return "un vendedor respondió a mano";
    case "pausado_handover":
      return s.pausedUntil
        ? `pasado a humano · se reactiva solo el ${timeFormat.format(new Date(s.pausedUntil))}`
        : "pasado a humano";
    case "pausado_antibucle":
      return "freno de seguridad: necesita revisión humana";
    default:
      return "";
  }
}
