// Presentación de las señales de la tarjeta del Embudo (PURO: lo usan el servidor y
// el tablero en el navegador). Las señales las calcula lib/contacts/funnel-signals.ts.

export type FunnelSignal = { unread: number; pending: boolean; urgent: boolean };

// Fondo de la tarjeta: amarillo si el Agente IA necesita al vendedor (gana), azul si
// hay mensajes del cliente por contestar; sin señal, el blanco de siempre.
export type FunnelTone = "urgent" | "pending";

export function funnelTone(signal: FunnelSignal | undefined): FunnelTone | undefined {
  if (signal?.urgent) return "urgent";
  if (signal?.pending) return "pending";
  return undefined;
}

// Texto del círculo de no vistos (mismo tope que la lista de la Bandeja). "" = sin círculo.
export function unreadBadge(count: number | undefined): string {
  if (!count || count < 1) return "";
  return count > 99 ? "99+" : String(Math.trunc(count));
}
