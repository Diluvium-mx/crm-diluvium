// El texto que saldría en un intento con la ventana abierta (docs/seguimientos.md §7.3): el
// borrador del lector TAL CUAL (decisión del dueño, 2-oct-2026: sin otra llamada al modelo)
// con el saludo que pone el CRM según la hora del cliente a la que sale. PURO.
// SIN el nombre del cliente (decisión del dueño, 6-oct-2026): el nombre del perfil de WhatsApp o de
// Instagram muchas veces no es su nombre («Doble», un apodo, un @usuario), así que nunca se usa.
import { localMinutes } from "./time";

export function greetingFor(t: Date, zone: string): string {
  const m = localMinutes(t, zone);
  if (m < 12 * 60) return "buenos días";
  if (m < 19 * 60) return "buenas tardes";
  return "buenas noches";
}

/** "Hola, buenas noches, le escribo de parte del equipo de Diluvium. ¿Pudo medir…?" */
export function followUpText(borrador: string, t: Date, zone: string): string {
  return `Hola, ${greetingFor(t, zone)}, le escribo de parte del equipo de Diluvium. ${borrador.trim()}`;
}
