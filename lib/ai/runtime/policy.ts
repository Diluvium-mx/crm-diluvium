// Política del runtime del Agente IA (Fase B). PURO: sin DB, red ni SDK — es el
// "criterio" testeable que envuelve al runtime. El worker (wiring) consulta la
// base, llama a estas funciones y aplica el resultado (pausas, envío, etc.).
//
// Cubre: debounce deslizante con tope, reactivación por vencimiento (handover),
// la compuerta de decisión (interruptor de canal, estado, ventana 24h, anti-bucle,
// tope por contacto, silencio por respuesta humana) y el corte en burbujas.

import { TAG_ANTI_LOOP } from "./tags";

export type AgentMode = "off" | "borrador" | "auto";
export type AgentState = "activo" | "pausado_humano" | "pausado_handover" | "pausado_antibucle";

// ── Debounce deslizante ──────────────────────────────────────────────────────
// Cada entrante reinicia la espera (`responseDelaySeconds`), pero nunca más allá
// del tope (`maxWaitSeconds`) contado desde el PRIMER entrante sin responder.
export type DebounceInput = {
  now: number; // epoch ms
  firstPendingAt: number; // epoch ms del entrante más viejo aún sin responder
  lastInboundAt: number; // epoch ms del entrante más reciente
  responseDelaySeconds: number;
  maxWaitSeconds: number;
};

// Delay (ms) desde `now` hasta que debe dispararse el job de respuesta.
export function debounceDelayMs(i: DebounceInput): number {
  const soft = i.lastInboundAt + i.responseDelaySeconds * 1000;
  const hard = i.firstPendingAt + i.maxWaitSeconds * 1000;
  const fireAt = Math.min(soft, hard);
  return Math.max(0, fireAt - i.now);
}

// Piso al volver al debounce tras descartar respuestas: nunca 0 (el tope duro ya
// venció y un cliente que no para de escribir haría correr el job en bucle).
export function rescheduleDelayMs(i: DebounceInput): number {
  return Math.max(i.responseDelaySeconds * 1000, debounceDelayMs(i));
}

// Tope de llamadas cobradas por conversación y hora: cada respuesta cuesta
// filtro + cerebro (2) y deja holgura para descartes y filtros sin respuesta.
export function maxModelCallsPerHour(antiLoopMaxPerHour: number): number {
  return Math.max(12, antiLoopMaxPerHour * 4);
}

// ── Reactivación por vencimiento (solo handover) ─────────────────────────────
// El "pasar a humano" se reactiva solo a las N horas; humano/antibucle son manuales.
export function pauseElapsed(state: AgentState, pausedUntil: number | null, now: number): boolean {
  return state === "pausado_handover" && pausedUntil !== null && now >= pausedUntil;
}

// ── Compuerta de decisión al dispararse el job ───────────────────────────────
export type GateInput = {
  channelMode: AgentMode;
  agentState: AgentState;
  agentPausedUntil: number | null;
  now: number;
  windowExpiresAt: number | null; // ventana de 24h; el agente solo actúa dentro
  humanRepliedSincePending: boolean; // vendedor respondió a mano (crm/business_app) tras el último entrante
  agentRepliesLastHour: number;
  antiLoopMaxPerHour: number;
  // Llamadas COBRADAS al modelo (filtro + cerebro, también las descartadas) en la última hora.
  modelCallsLastHour: number;
  agentRepliesToContact: number;
  maxRepliesPerContact: number | null; // null = sin tope
};

export type GateDecision =
  // No responder; `pauseTo`/`tag` indican una transición de estado a persistir.
  | { action: "skip"; reason: string; pauseTo?: AgentState; tag?: string }
  // Responder. `reactivated` = venía de handover vencido y se reactiva a `activo`.
  | { action: "respond"; mode: "borrador" | "auto"; reactivated: boolean };

// Evalúa las compuertas EN ORDEN. La clasificación de contenido (spam / lead que
// no sigue / necesita cerebro / pasar a humano) la hace el modelo FILTRO en el
// wiring; aquí van las compuertas duras de interruptor y seguridad.
export function decideGate(i: GateInput): GateDecision {
  // 1. Interruptor del canal (gate maestro).
  if (i.channelMode === "off") return { action: "skip", reason: "canal_off" };

  // 2. Estado de pausa. handover vencido → reactiva y sigue; el resto → calla.
  const reactivated = pauseElapsed(i.agentState, i.agentPausedUntil, i.now);
  if (i.agentState !== "activo" && !reactivated) {
    return { action: "skip", reason: i.agentState }; // pausado_humano | pausado_handover (vigente) | pausado_antibucle
  }

  // 3. Silencio si un humano respondió a mano en el hilo → pausa indefinida.
  if (i.humanRepliedSincePending) {
    return { action: "skip", reason: "respuesta_humana", pauseTo: "pausado_humano" };
  }

  // 4. Ventana de 24h: la Fase B solo responde texto dentro de la ventana.
  if (i.windowExpiresAt === null || i.now > i.windowExpiresAt) {
    return { action: "skip", reason: "fuera_de_ventana_24h" };
  }

  // 5. Freno anti-bucle: tope de respuestas del agente por hora → pausa + revisión humana.
  if (i.agentRepliesLastHour >= i.antiLoopMaxPerHour) {
    return { action: "skip", reason: "anti_bucle", pauseTo: "pausado_antibucle", tag: TAG_ANTI_LOOP };
  }
  // 5b. Tope de GASTO: un cliente que escribe sin parar hace que las respuestas se
  // descarten y regeneren sin llegar nunca al anti-bucle; esto sí lo frena.
  if (i.modelCallsLastHour >= maxModelCallsPerHour(i.antiLoopMaxPerHour)) {
    return { action: "skip", reason: "tope_de_llamadas", pauseTo: "pausado_antibucle", tag: TAG_ANTI_LOOP };
  }

  // 6. Tope total por contacto (opcional).
  if (i.maxRepliesPerContact !== null && i.agentRepliesToContact >= i.maxRepliesPerContact) {
    return { action: "skip", reason: "tope_por_contacto" };
  }

  // 7. Responder según el modo del canal.
  return { action: "respond", mode: i.channelMode, reactivated };
}

// ── Corte en burbujas ────────────────────────────────────────────────────────
// El Goal pide separar bloques con doble salto de línea. Se cortan por línea en
// blanco y se limita a `max` (2); el excedente se une a la última burbuja para
// no perder texto. La pausa de 1.5s entre burbujas la aplica el envío (wiring).
export function toBubbles(text: string, max = 2): string[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= max) return parts;
  const head = parts.slice(0, max - 1);
  const tail = parts.slice(max - 1).join("\n\n");
  return [...head, tail];
}
