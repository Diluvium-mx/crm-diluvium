// Ajustes del runtime del Agente IA editables en la pestaña (Fase B). Esquema
// PURO (sin servidor): lo usan la acción de servidor para validar y el cliente
// para los tipos. Los rangos evitan valores que romperían al agente.
import { z } from "zod";

export const agentSettingsSchema = z
  .object({
    responseDelaySeconds: z.number().int().min(0, "Mínimo 0 s").max(600, "Máximo 600 s"),
    maxWaitSeconds: z.number().int().min(5, "Mínimo 5 s").max(900, "Máximo 900 s"),
    pauseOnHumanReply: z.boolean(),
    handoverReactivateHours: z.number().int().min(1, "Mínimo 1 h").max(168, "Máximo 168 h (7 días)"),
    antiLoopMaxPerHour: z.number().int().min(1, "Mínimo 1").max(100, "Máximo 100"),
    maxRepliesPerContact: z.number().int().min(1, "Mínimo 1").max(10_000, "Máximo 10,000").nullable(),
    contextMessages: z.number().int().min(1, "Mínimo 1").max(50, "Máximo 50"),
    maxBubbles: z.number().int().min(1, "Mínimo 1").max(5, "Máximo 5"),
    dailyBudgetUsd: z.number().min(1, "Mínimo 1 USD").max(1_000, "Máximo 1,000 USD"),
  })
  .refine((s) => s.maxWaitSeconds >= s.responseDelaySeconds, {
    message: "La espera máxima no puede ser menor que la espera antes de responder.",
    path: ["maxWaitSeconds"],
  });

export type AgentSettings = z.infer<typeof agentSettingsSchema>;

export const agentModeSchema = z.enum(["off", "borrador", "auto"]);
export type AgentModeValue = z.infer<typeof agentModeSchema>;

export const AGENT_MODE_LABEL: Record<AgentModeValue, string> = {
  off: "Apagado",
  borrador: "Borrador",
  auto: "Automático",
};

// Ids que llegan del cliente a las Server Actions del agente (CLAUDE.md §7: Zod en todo borde).
export const idSchema = z.string().trim().min(1, "Falta el identificador.").max(200);

export const priceSchema = z.object({
  modelId: z.string().min(1),
  inputPerMTok: z.number().min(0).max(1_000),
  outputPerMTok: z.number().min(0).max(1_000),
});
