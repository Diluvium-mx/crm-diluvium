// CEREBRO del Agente IA (Fase B): system = Goal + FAQs (cacheado por el
// adaptador) + un sufijo FIJO del CRM con las reglas del runtime. Puro.
import { buildBrainSystem, type Faq } from "./knowledge";

// Señal para transferir a humano (la Fase B no tiene herramientas todavía).
export const HANDOVER_TOKEN = "[TRANSFERIR]";

// Sufijo fijo (depende solo de maxBubbles, que cambia rara vez): va DESPUÉS del
// Goal y las FAQs, así el prefijo largo sigue siendo idéntico entre llamadas y
// la caché del proveedor lo reutiliza.
export function runtimeSuffix(maxBubbles: number): string {
  return `INSTRUCCIONES DEL CRM (Fase B)
- Escribe SOLO el texto que se enviará al cliente por WhatsApp, como Angela. Sin comillas, sin etiquetas y sin explicar tu razonamiento.
- Máximo ${maxBubbles} bloque(s), separados por una línea en blanco.
- Si según el Goal corresponde "Transferencia a humano", responde EXACTAMENTE ${HANDOVER_TOKEN} y nada más.
- La acción "Datos bancarios" todavía no está disponible en este CRM: si corresponde activarla, responde EXACTAMENTE ${HANDOVER_TOKEN} (un asesor enviará los datos).
- El envío de videos o tablas todavía no está disponible: responde la duda solo con texto y no prometas enviar archivos.
- No cambies etapas ni prometas acciones del sistema; eso lo hace el equipo.`;
}

export function buildBrainSystemWithRuntime(goal: string, faqs: readonly Faq[], maxBubbles: number): string {
  return `${buildBrainSystem(goal, faqs)}\n\n${runtimeSuffix(maxBubbles)}`;
}

export type BrainOutput = { kind: "handover" } | { kind: "reply"; text: string } | { kind: "empty" };

// Interpreta la salida del cerebro. El token de transferencia gana aunque venga
// acompañado de texto (el Goal pide dejar de responder al transferir).
export function parseBrainOutput(raw: string): BrainOutput {
  const text = raw.trim();
  if (text.includes(HANDOVER_TOKEN)) return { kind: "handover" };
  if (!text) return { kind: "empty" };
  return { kind: "reply", text };
}
