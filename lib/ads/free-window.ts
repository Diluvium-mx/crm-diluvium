// Ventana GRATIS de 72 h de los anuncios de clic a WhatsApp (entrada gratuita
// de Meta, "free entry point"). Regla de Meta: cuando el cliente llega por un
// anuncio CTWA y el negocio le RESPONDE dentro de las 24 h, esa respuesta abre
// una ventana de 72 h en la que todos los mensajes del negocio (también las
// plantillas) son gratis. Es distinta de la ventana de 24 h de servicio: esa
// decide si se puede mandar texto libre; esta decide si se cobra.
//
// Puro (sin base de datos). La conversación guarda cuándo entró el cliente por
// un anuncio (conversations.ad_entry_at); la primera respuesta del negocio
// posterior sale de los mensajes.

const HOUR = 3_600_000;
export const FREE_WINDOW_REPLY_HOURS = 24;
export const FREE_WINDOW_HOURS = 72;

export type FreeWindow =
  /** Aún no se responde, y todavía se está a tiempo (hasta `replyBy`). */
  | { status: "pending"; replyBy: Date }
  /** Abierta hasta `until`. */
  | { status: "open"; openedAt: Date; until: Date }
  /** Se abrió y ya cerró. */
  | { status: "expired"; openedAt: Date; until: Date }
  /** No se respondió dentro de las 24 h: no hubo ventana gratis. */
  | { status: "missed" };

export function freeEntryWindow(entryAt: Date | null, firstReplyAt: Date | null, now: Date): FreeWindow | null {
  if (!entryAt) return null;
  const replyBy = new Date(entryAt.getTime() + FREE_WINDOW_REPLY_HOURS * HOUR);
  if (firstReplyAt && firstReplyAt >= entryAt && firstReplyAt <= replyBy) {
    const until = new Date(firstReplyAt.getTime() + FREE_WINDOW_HOURS * HOUR);
    return now < until ? { status: "open", openedAt: firstReplyAt, until } : { status: "expired", openedAt: firstReplyAt, until };
  }
  return now < replyBy && !firstReplyAt ? { status: "pending", replyBy } : { status: "missed" };
}
