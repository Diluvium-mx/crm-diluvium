// El lote de lecturas de la pestaña (lib/inbox/lote-cliente.ts) con su Server Action real. Las piezas del
// chat leen con `leer("nombre", …)` en vez de llamar la acción suelta: misma respuesta, menos viajes.
import { leerLote } from "@/lib/inbox/lecturas-actions";
import type { LectoresDeLote } from "@/lib/inbox/lecturas";
import { crearLote } from "@/lib/inbox/lote-cliente";

/** Mensajes de la primera página de un chat (chat-thread.tsx); la precarga pide exactamente lo mismo. */
export const PAGINA_CHAT = 30;

const lote = crearLote<LectoresDeLote>(leerLote);
export const { leer, olvidarPrecarga } = lote;

/**
 * Al abrir un chat de la Bandeja: todo lo que piden sus piezas al montarse, en UN viaje (antes, ~10 en
 * fila). Lo del contacto solo si su Detalle está a la vista (si no, nadie lo pediría).
 */
export function precargarChat(conversationId: string, contactId: string | null) {
  lote.precargar([
    ["getConversation", conversationId],
    ["listMessages", conversationId, { limit: PAGINA_CHAT }],
    ["getConversationAgent", conversationId],
    ["listScheduledMessages", conversationId],
    ["getFollowUp", conversationId],
    ["getAgentActivity", conversationId],
  ]);
  if (contactId) {
    lote.precargar([
      ["getContactDetails", contactId],
      ["getContactAgentStatus", contactId],
      ["getLectorStatus", contactId],
    ]);
  }
}
