// Política del runtime del Agente IA (Fase B). PURO: sin DB, red ni SDK — es el
// "criterio" testeable que envuelve al runtime. El worker (wiring) consulta la
// base, llama a estas funciones y aplica el resultado (pausa, avisos, envío).
//
// Cubre: debounce deslizante con tope, la compuerta de decisión (interruptor de
// canal, estado, ventana 24h, anti-bucle, tope por contacto, silencio por
// respuesta humana) y el corte en burbujas.
//
// Reglas del dueño (23-sep-2026): el agente SIEMPRE contesta. Lo ÚNICO que lo
// pausa es la respuesta de un vendedor (se reactiva con "Reactivar"). Los frenos
// (anti-bucle, tope de llamadas, presupuesto, tope por contacto) solo dejan de
// responder esa vez y avisan al vendedor; nunca pausan ni etiquetan.

// "borrador" sigue en el enum de la BD como historia: se trata igual que "off".
export type AgentMode = "off" | "borrador" | "auto";
export type AgentState = "activo" | "pausado_humano" | "pausado_handover" | "pausado_antibucle";

// Tipos de aviso del agente para el vendedor (ver notices.ts).
export type NoticeKind = "guardia" | "pasar_a_humano" | "anti_bucle" | "presupuesto" | "tope_contacto" | "envio";

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

// Qué entrantes pendientes cuentan para el debounce: solo los posteriores al
// último corte (último entrante ya atendido —aunque el filtro lo haya saltado—,
// reactivación del agente o encendido del canal). Sin esto, un "gracias" que el
// filtro saltó días atrás seguiría "pendiente", el tope ya habría vencido y el
// siguiente mensaje dispararía al instante (sin debounce → dos respuestas).
export function debounceWindow(
  arrivals: readonly number[], // epoch ms de llegada de los pendientes, cualquier orden
  cutoffs: readonly (number | null)[],
): { firstPendingAt: number; lastInboundAt: number } | null {
  if (arrivals.length === 0) return null;
  const cut = Math.max(-Infinity, ...cutoffs.filter((c): c is number => c !== null));
  const last = Math.max(...arrivals);
  const fresh = arrivals.filter((a) => a > cut);
  return { firstPendingAt: fresh.length ? Math.min(...fresh) : last, lastInboundAt: last };
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

// ── Compuerta de decisión al dispararse el job ───────────────────────────────
export type GateInput = {
  channelMode: AgentMode;
  agentState: AgentState;
  now: number;
  windowExpiresAt: number | null; // ventana de 24h; el agente solo actúa dentro
  humanRepliedSincePending: boolean; // vendedor respondió a mano (crm/business_app) tras el último entrante
  agentRepliesLastHour: number;
  antiLoopMaxPerHour: number;
  // Llamadas COBRADAS al modelo (filtro + cerebro, también las descartadas) en la última hora.
  modelCallsLastHour: number;
  // Hay un envío del agente en camino ("queued") o un plan de burbujas "enviando":
  // no se responde encima (lo concilian el outbox y el barrido).
  agentSendUnresolved: boolean;
  // Gasto de TODA la organización en las últimas 24 h (USD) y su presupuesto.
  orgSpendLast24hUsd: number;
  dailyBudgetUsd: number;
  agentRepliesToContact: number;
  maxRepliesPerContact: number | null; // null = sin tope
};

export type GateDecision =
  // No responder. `pauseTo`: la única pausa (un vendedor contestó). `notice`: avisar
  // al vendedor en el hilo (frenos), sin pausar.
  | { action: "skip"; reason: string; pauseTo?: "pausado_humano"; notice?: NoticeKind }
  | { action: "respond" };

// Evalúa las compuertas EN ORDEN. La clasificación de contenido (spam / lead que
// no sigue / necesita cerebro / pasar a humano) la hace el modelo FILTRO en el
// wiring; aquí van las compuertas duras de interruptor y seguridad.
export function decideGate(i: GateInput): GateDecision {
  // 1. Interruptor del canal (gate maestro): solo "auto" responde.
  if (i.channelMode !== "auto") return { action: "skip", reason: "canal_off" };

  // 2. Pausado (un vendedor contestó o lo pausó a mano): calla hasta "Reactivar".
  if (i.agentState !== "activo") return { action: "skip", reason: i.agentState };

  // 3. Un vendedor respondió a mano en el hilo → pausa indefinida.
  if (i.humanRepliedSincePending) {
    return { action: "skip", reason: "respuesta_humana", pauseTo: "pausado_humano" };
  }

  // 4. Ventana de 24h: la Fase B solo responde texto dentro de la ventana.
  if (i.windowExpiresAt === null || i.now > i.windowExpiresAt) {
    return { action: "skip", reason: "fuera_de_ventana_24h" };
  }

  // 4b. Envío del agente todavía en camino: esperar (lo concilia el outbox/barrido).
  if (i.agentSendUnresolved) {
    return { action: "skip", reason: "envio_sin_confirmar" };
  }

  // 5. Freno anti-bucle (bucle real con otro bot): no responde esta vez y avisa.
  if (i.agentRepliesLastHour >= i.antiLoopMaxPerHour) {
    return { action: "skip", reason: "anti_bucle", notice: "anti_bucle" };
  }
  // 5b. Tope de GASTO: un cliente que escribe sin parar hace que las respuestas se
  // descarten y regeneren sin llegar nunca al anti-bucle; esto sí lo frena.
  if (i.modelCallsLastHour >= maxModelCallsPerHour(i.antiLoopMaxPerHour)) {
    return { action: "skip", reason: "tope_de_llamadas", notice: "anti_bucle" };
  }

  // 5c. Presupuesto diario de la ORGANIZACIÓN: vuelve solo al bajar la ventana de 24 h.
  if (i.orgSpendLast24hUsd >= i.dailyBudgetUsd) {
    return { action: "skip", reason: "presupuesto_diario", notice: "presupuesto" };
  }

  // 6. Tope total por contacto (opcional).
  if (i.maxRepliesPerContact !== null && i.agentRepliesToContact >= i.maxRepliesPerContact) {
    return { action: "skip", reason: "tope_por_contacto", notice: "tope_contacto" };
  }

  return { action: "respond" };
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
