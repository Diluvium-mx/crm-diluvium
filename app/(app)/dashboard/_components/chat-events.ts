// Menos llamadas por mensaje en el chat abierto (Bandeja y pop-up del Embudo, 9-oct-2026).
// Next manda las Server Actions de una pestaña UNA POR UNA: cada llamada de fondo de más
// retrasa el clic del vendedor. Un envío genera varios avisos SSE en segundos (se guardó,
// enviado, entregado, leído, y la conversación cambió), y antes cada aviso releía todo.

/** Avisos que llegan con menos de esto entre sí se juntan en una sola relectura. */
export const EVENT_BATCH_MS = 250;

/**
 * «Leído» una sola vez por mensaje: sus cambios de estado (enviado → entregado → leído,
 * media procesada) vuelven a avisar `message.upserted` con el mismo id, y cada marca es una
 * transacción que bloquea la conversación (FOR UPDATE). Recuerda los últimos `limit` ids.
 */
export function createReadMarks(limit = 200): { first: (messageId: string) => boolean } {
  const seen = new Set<string>();
  return {
    first(messageId) {
      if (seen.has(messageId)) return false;
      seen.add(messageId);
      if (seen.size > limit) {
        const oldest = seen.values().next();
        if (!oldest.done) seen.delete(oldest.value);
      }
      return true;
    },
  };
}

/**
 * ¿Llegó o se fue un mensaje? (cambió el más reciente del hilo). Un cambio de estado no
 * cuenta: la píldora del Agente IA, sus avisos y los programados solo se releen con esto.
 * `previous` undefined = primera carga de esta conversación (sus partes ya cargaron solas).
 */
export function newestChanged(previous: readonly { id: string }[] | undefined, next: readonly { id: string }[]): boolean {
  if (previous === undefined) return false;
  return (previous.at(-1)?.id ?? null) !== (next.at(-1)?.id ?? null);
}
