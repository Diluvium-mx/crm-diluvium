// CEREBRO del Agente IA (Fase B): system = Goal completo + las FAQs activas
// (cacheado por el adaptador) + un sufijo FIJO del CRM. Puro.
//
// Definición del dueño (23-sep-2026): el agente se rige SOLO por el Goal y las FAQs,
// como Ángela en GHL. El sufijo no agrega reglas de comportamiento, precios ni
// formato: solo dice qué devolver y cómo se "activan" en este CRM las acciones del
// Goal que aquí todavía no existen (así el cliente nunca espera algo que no llega).
import { buildBrainSystem, type Faq } from "./knowledge";

// Señal de respaldo de "Transferencia a humano" (la herramienta wf_transferir_humano
// hace lo mismo). El agente la agrega AL FINAL: el CRM la quita, envía el resto y
// deja un aviso al vendedor en la Bandeja. El agente sigue activo.
export const HANDOVER_TOKEN = "[TRANSFERIR]";

// Si el modelo solo devolvió la señal (sin texto para el cliente), el cliente
// igual recibe respuesta: el agente SIEMPRE contesta.
export const HANDOVER_FALLBACK_TEXT = "Con gusto, en un momento te atiende un asesor.";

// Sufijo fijo: va DESPUÉS del Goal y las FAQs, así el prefijo largo es idéntico
// entre llamadas y la caché del proveedor lo reutiliza.
export const RUNTIME_SUFFIX = `INSTRUCCIONES DEL CRM
- Escribe solo el texto que se enviará al cliente por WhatsApp, sin etiquetas ni explicaciones.
- Las acciones del Goal (tabla de tamaños, videos de instalación, datos bancarios, tapones, dónde medir, medidas especiales, cambiar de etapa, pasar a humano, confirmar un pago) se activan llamando la herramienta que corresponda en la MISMA respuesta: primero tu texto para el cliente y luego la llamada. El CRM envía el archivo después de tu texto. No prometas enviar algo sin llamar su herramienta; si no hay herramienta para eso, responde solo con texto.
- Cada vez que le digas un total al cliente, llama fijar_cotizacion con ese total en pesos.
- Si el cliente manda la imagen de un comprobante de pago, lee monto, fecha, banco y referencia y llama pago_confirmado (o anticipo_confirmado si es el 50 % de una compuerta a la medida). El CRM verifica el monto contra lo cotizado antes de confirmar: escribe tu texto como si el pago cuadrara y el CRM lo sustituye si no cuadra.
- Para "Transferencia a humano" también puedes escribir ${HANDOVER_TOKEN} al final, en una línea aparte. Si el cliente vuelve a escribir antes de que conteste un asesor, sigue atendiéndolo.`;

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
