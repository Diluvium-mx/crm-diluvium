// CEREBRO del Agente IA (Fase B): system = Goal completo + las FAQs activas
// (cacheado por el adaptador) + un sufijo FIJO del CRM. Puro.
//
// Definición del dueño (23-sep-2026): el agente se rige SOLO por el Goal y las FAQs,
// como Ángela en GHL. El sufijo no agrega reglas de comportamiento, precios ni
// formato: solo dice qué devolver y cómo se "activan" en este CRM las acciones del
// Goal que aquí todavía no existen (así el cliente nunca espera algo que no llega).
import { buildBrainSystem, type Faq } from "./knowledge";

// Señal de la acción "Transferencia a humano" (y de "Datos bancarios", que aún no
// existe en el CRM). El agente la agrega AL FINAL: el CRM la quita, envía el resto
// y deja un aviso al vendedor en la Bandeja. El agente sigue activo.
export const HANDOVER_TOKEN = "[TRANSFERIR]";

// Si el modelo solo devolvió la señal (sin texto para el cliente), el cliente
// igual recibe respuesta: el agente SIEMPRE contesta.
export const HANDOVER_FALLBACK_TEXT = "Con gusto, en un momento te atiende un asesor.";

// Sufijo fijo: va DESPUÉS del Goal y las FAQs, así el prefijo largo es idéntico
// entre llamadas y la caché del proveedor lo reutiliza.
export const RUNTIME_SUFFIX = `INSTRUCCIONES DEL CRM
- Escribe solo el texto que se enviará al cliente por WhatsApp, sin etiquetas ni explicaciones.
- Para activar "Transferencia a humano" o "Datos bancarios", dile al cliente lo que corresponda según el Goal (que un asesor lo atenderá o le enviará los datos) y escribe ${HANDOVER_TOKEN} al final, en una línea aparte. Si el cliente vuelve a escribir antes de que conteste un asesor, sigue atendiéndolo.
- En este CRM todavía no se pueden enviar tablas ni videos ni cambiar etapas: responde con texto y no prometas enviarlos.`;

export function buildBrainSystemWithRuntime(goal: string, faqs: readonly Faq[]): string {
  return `${buildBrainSystem(goal, faqs)}\n\n${RUNTIME_SUFFIX}`;
}

// `handover` = el agente activó la transferencia (la señal ya no va en `text`).
export type BrainOutput = { kind: "reply"; text: string; handover: boolean } | { kind: "empty" };

// Interpreta la salida del cerebro. La señal de pase a humano se quita del texto;
// si solo venía la señal, el cliente recibe el texto de respaldo.
export function parseBrainOutput(raw: string): BrainOutput {
  const handover = raw.includes(HANDOVER_TOKEN);
  const text = raw.split(HANDOVER_TOKEN).join("").replace(/\n{3,}/g, "\n\n").trim();
  if (handover) return { kind: "reply", text: text || HANDOVER_FALLBACK_TEXT, handover: true };
  if (!text) return { kind: "empty" };
  return { kind: "reply", text, handover: false };
}
