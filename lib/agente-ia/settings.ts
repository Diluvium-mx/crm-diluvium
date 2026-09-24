// Esquemas PUROS (sin servidor) de la pestaña Agente IA: interruptor por canal,
// ids y precios. Desde el 23-sep-2026 no hay tiempos, pausas ni límites editables.
import { z } from "zod";

// Interruptor por canal: Apagado / Encendido (= responde solo, AUTO). Desde el
// 23-sep-2026 no hay modo "borrador" (queda en el enum de la BD como historia).
export const agentModeSchema = z.enum(["off", "auto"]);
export type AgentModeValue = z.infer<typeof agentModeSchema>;

export const AGENT_MODE_LABEL: Record<AgentModeValue, string> = {
  off: "Apagado",
  auto: "Encendido",
};

// Modo de la BD → modo de la UI ("borrador", ya sin uso, cuenta como apagado).
export function toAgentMode(dbMode: string): AgentModeValue {
  return dbMode === "auto" ? "auto" : "off";
}

// Ids que llegan del cliente a las Server Actions del agente (CLAUDE.md §7: Zod en todo borde).
export const idSchema = z.string().trim().min(1, "Falta el identificador.").max(200);
