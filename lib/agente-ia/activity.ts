// Estado "en vivo" del Agente IA en una conversación, para el indicador del chat
// (píldora con orbe). PURO: recibe lo que ya se leyó de la cola y de la base y
// decide qué mostrar. Depende de dos contratos de Fase D (CLAUDE.md §6):
//   - cola "agent-replies": jobId = conversationId (lib/ai/runtime/queue.ts);
//   - workflow_runs.trigger ∈ agent|keyword|command|stage y status queued|running|…
import type { AgentModeValue } from "./settings";
import type { AgentStateValue } from "./types";

export type AgentActivity = "leyendo" | "escribiendo" | "enviando" | null;

/** Lo que se sabe del job de la cola (null = no hay job). */
export type AgentJobInfo = { state: string; attemptsMade: number } | null;

/** Corridas de workflow abiertas de la conversación. */
export type ActiveRun = { trigger: string; status: string; triggeredByUserId: string | null };

// Corrida que el AGENTE está mandando (tabla, video, datos bancarios): la disparó
// él, una palabra clave del cliente o un cambio de etapa que no hizo un vendedor.
export function isAgentRun(run: ActiveRun): boolean {
  if (run.status !== "queued" && run.status !== "running") return false;
  if (run.trigger === "agent" || run.trigger === "keyword") return true;
  return run.trigger === "stage" && run.triggeredByUserId === null;
}

export function resolveAgentActivity(input: {
  job: AgentJobInfo;
  runs: readonly ActiveRun[];
  agentState: AgentStateValue;
  channelMode: AgentModeValue | string;
}): AgentActivity {
  // Agente pausado o canal fuera de "auto": aunque quede un job viejo, no va a
  // contestar; no se muestra nada.
  if (input.agentState !== "activo" || input.channelMode !== "auto") return null;
  const job = input.job;
  if (job) {
    // Espera de debounce (juntar mensajes) o en fila sin haber intentado: leyendo.
    if ((job.state === "delayed" || job.state === "waiting" || job.state === "prioritized") && job.attemptsMade === 0) return "leyendo";
    // Corriendo, o reintentando tras un fallo: escribiendo.
    if (job.state === "active" || (job.state === "delayed" && job.attemptsMade > 0)) return "escribiendo";
  }
  if (input.runs.some(isAgentRun)) return "enviando";
  return null;
}
