// Presentación de las señales de la tarjeta del Embudo (PURO: lo usan el servidor y
// el tablero en el navegador). Las señales las calcula lib/contacts/funnel-signals.ts.

// lastInboundAt: hora (epoch ms) del último mensaje del cliente en cualquiera de sus
// chats; con ella la tarjeta sube arriba de su columna en vivo. null = nunca escribió.
export type FunnelSignal = { unread: number; pending: boolean; urgent: boolean; lastInboundAt: number | null };

// Fondo de la tarjeta: amarillo si el Agente IA necesita al vendedor (gana), azul si
// el cliente escribió y nadie le ha contestado ni lo marcó como leído; sin señal, el
// blanco de siempre.
export type FunnelTone = "urgent" | "pending";

export function funnelTone(signal: FunnelSignal | undefined): FunnelTone | undefined {
  if (signal?.urgent) return "urgent";
  if (signal?.pending) return "pending";
  return undefined;
}

// ¿Hay algo que «Marcar como leído» pueda apagar? El círculo naranja o el azul. El
// amarillo no: ese solo se apaga contestando.
export function canMarkRead(signal: FunnelSignal | undefined): boolean {
  return (signal?.unread ?? 0) > 0 || signal?.pending === true;
}

// Texto del círculo de no vistos (mismo tope que la lista de la Bandeja). "" = sin círculo.
export function unreadBadge(count: number | undefined): string {
  if (!count || count < 1) return "";
  return count > 99 ? "99+" : String(Math.trunc(count));
}
