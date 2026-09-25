// Política del runtime del Agente IA (Fase B). PURO: sin DB, red ni SDK — es el
// "criterio" testeable que envuelve al runtime. El worker (wiring) consulta la
// base, llama a estas funciones y aplica el resultado (pausa, envío).
//
// Definición del dueño (23-sep-2026): el agente es el motor que hace que siempre
// haya alguien respondiendo, como Ángela en GHL. Responde TODO lo que entra, sin
// trabas. Lo ÚNICO que lo pausa es que un vendedor conteste en la conversación; se
// reactiva solo a mano con "Reactivar". Sin freno anti-bucle, sin presupuesto y sin
// topes: el gasto lo controlan las llaves de los proveedores y el saldo del Dashboard.

// "borrador" sigue en el enum de la BD como historia: se trata igual que "off".
export type AgentMode = "off" | "borrador" | "auto";
export type AgentState = "activo" | "pausado_humano" | "pausado_handover" | "pausado_antibucle";

// Avisos del agente para el vendedor en la Bandeja (ver notices.ts).
// pasar_a_humano queda por las filas viejas; desde el 24-sep los avisos del agente
// son los tres motivos de aviso_vendedor (+ "envio" para fallos de envío del CRM).
export type NoticeKind = "pasar_a_humano" | "envio" | "cotejar_deposito" | "cliente_pide_humano" | "comprobante_dudoso";

// ── Debounce deslizante (interno y fijo, como Ángela en GHL) ─────────────────
// Cada entrante reinicia la espera de 15 s, pero nunca más de 60 s desde el
// PRIMER entrante sin responder.
export const RESPONSE_DELAY_SECONDS = 15;
export const MAX_WAIT_SECONDS = 60;

export type DebounceInput = {
  now: number; // epoch ms
  firstPendingAt: number; // epoch ms del entrante más viejo aún sin responder
  lastInboundAt: number; // epoch ms del entrante más reciente
};

// Delay (ms) desde `now` hasta que debe dispararse el job de respuesta.
export function debounceDelayMs(i: DebounceInput): number {
  const soft = i.lastInboundAt + RESPONSE_DELAY_SECONDS * 1000;
  const hard = i.firstPendingAt + MAX_WAIT_SECONDS * 1000;
  const fireAt = Math.min(soft, hard);
  return Math.max(0, fireAt - i.now);
}

// Qué entrantes pendientes cuentan para el debounce: solo los posteriores al
// último corte (último entrante ya atendido, reactivación del agente o encendido
// del canal). Sin esto, un pendiente viejo ya habría vencido el tope y el
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

// Piso al volver al debounce tras descartar respuestas (el cliente siguió
// escribiendo): nunca 0, así un cliente que no para de escribir no hace correr
// el job en bucle; responde cuando haga una pausa.
export function rescheduleDelayMs(i: DebounceInput): number {
  return Math.max(RESPONSE_DELAY_SECONDS * 1000, debounceDelayMs(i));
}

// ── Compuerta de decisión al dispararse el job ───────────────────────────────
export type GateInput = {
  channelMode: AgentMode;
  agentState: AgentState;
  now: number;
  windowExpiresAt: number | null; // ventana de 24h; el agente solo actúa dentro
  humanRepliedSincePending: boolean; // vendedor respondió (crm/business_app) tras el último corte
  // Hay un envío del agente en camino ("queued") o un plan de burbujas "enviando":
  // no se responde encima (lo concilian el outbox y el barrido).
  agentSendUnresolved: boolean;
};

export type GateDecision =
  // No responder. `pauseTo`: la única pausa (un vendedor contestó).
  | { action: "skip"; reason: string; pauseTo?: "pausado_humano" }
  | { action: "respond" };

export function decideGate(i: GateInput): GateDecision {
  // 1. Interruptor del canal: solo "auto" (Encendido) responde.
  if (i.channelMode !== "auto") return { action: "skip", reason: "canal_off" };
  // 2. Pausado (un vendedor contestó): calla hasta "Reactivar".
  if (i.agentState !== "activo") return { action: "skip", reason: i.agentState };
  // 3. Un vendedor respondió en el hilo → pausa hasta "Reactivar".
  if (i.humanRepliedSincePending) return { action: "skip", reason: "respuesta_humana", pauseTo: "pausado_humano" };
  // 4. Ventana de 24h: fuera de ella WhatsApp no deja mandar texto libre.
  if (i.windowExpiresAt === null || i.now > i.windowExpiresAt) return { action: "skip", reason: "fuera_de_ventana_24h" };
  // 5. Envío del agente todavía en camino: esperar (nunca contestar encima).
  if (i.agentSendUnresolved) return { action: "skip", reason: "envio_sin_confirmar" };
  return { action: "respond" };
}

// ── Mensajes para celular ────────────────────────────────────────────────────
// El Goal ("FORMATO PARA MÓVIL") separa la información y la pregunta con una
// línea en blanco. Se mandan como mensajes distintos (máx. 2), con una pausa
// corta entre ambos (la aplica el envío):
//   - información + pregunta → 2 mensajes (primero la información);
//   - un solo bloque corto → 1 mensaje; largo → 2 mensajes cortados entre oraciones;
//   - más de 2 bloques → 2 mensajes (lo último, si es pregunta, va solo al final).
// Nunca un solo bloque grande de texto.
export const MAX_BUBBLES = 2;
export const LONG_MESSAGE_CHARS = 320;

function isQuestion(text: string): boolean {
  return /[?¿]\s*\S{0,3}$/u.test(text.trim());
}

// Corta un bloque largo en 2 por la frontera de oración más cercana a la mitad.
function splitLong(text: string): string[] {
  if (text.length <= LONG_MESSAGE_CHARS) return [text];
  const boundaries: number[] = [];
  const re = /[.!?…](?:["»”)]*)\s+|\n+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) boundaries.push(m.index + m[0].length);
  const cuts = boundaries.filter((b) => b > 0 && b < text.length);
  if (cuts.length === 0) return [text];
  const mid = text.length / 2;
  const cut = cuts.reduce((best, b) => (Math.abs(b - mid) < Math.abs(best - mid) ? b : best));
  const [a, b] = [text.slice(0, cut).trim(), text.slice(cut).trim()];
  return a && b ? [a, b] : [text];
}

export function toBubbles(text: string): string[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) return splitLong(parts[0]);
  if (parts.length === MAX_BUBBLES) return parts;
  const last = parts[parts.length - 1];
  if (isQuestion(last)) return [parts.slice(0, -1).join("\n\n"), last];
  // Sin pregunta al final: dos mensajes de largo parecido, sin romper bloques.
  const total = parts.join("\n\n").length;
  let best = 1;
  let bestDiff = Infinity;
  for (let k = 1; k < parts.length; k++) {
    const head = parts.slice(0, k).join("\n\n").length;
    const diff = Math.abs(head - (total - head));
    if (diff < bestDiff) [best, bestDiff] = [k, diff];
  }
  return [parts.slice(0, best).join("\n\n"), parts.slice(best).join("\n\n")];
}
