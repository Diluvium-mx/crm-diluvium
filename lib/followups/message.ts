// El texto que saldría en un intento con la ventana abierta (docs/seguimientos.md §7.3): el
// borrador del lector TAL CUAL (decisión del dueño, 2-oct-2026: sin otra llamada al modelo)
// con el saludo que pone el CRM según la hora del cliente a la que sale. PURO.
import { localMinutes } from "./time";

export function greetingFor(t: Date, zone: string): string {
  const m = localMinutes(t, zone);
  if (m < 12 * 60) return "buenos días";
  if (m < 19 * 60) return "buenas tardes";
  return "buenas noches";
}

/** "Hola Ana, buenas noches. ¿Pudo medir…?" (sin nombre: "Hola, buenas noches. …"). */
export function followUpText(borrador: string, firstName: string, t: Date, zone: string): string {
  const name = firstName.trim();
  const saludo = `Hola${name ? ` ${name}` : ""}, ${greetingFor(t, zone)}.`;
  return `${saludo} ${borrador.trim()}`;
}
