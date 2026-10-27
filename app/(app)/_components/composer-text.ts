// «Poner rastreo en el chat» del Detalle (guías de Envia, 27-oct-2026): deja un texto en la caja de escribir
// del chat abierto, sin mandarlo (el vendedor lo manda cuando la guía sale a ruta). Por un evento de la
// ventana, como open-contact.ts. Si ninguna caja de ese chat lo toma (el Detalle está en el pop-up del Embudo,
// o el chat pasó las 24 h y solo deja mandar plantilla), `requestComposerText` devuelve false y quien lo pidió
// lo copia al portapapeles.
import { useEffect, useRef } from "react";

const COMPOSER_TEXT_EVENT = "crm:texto-al-chat";

type Detail = { conversationId: string; text: string };

export function requestComposerText(conversationId: string, text: string): boolean {
  const event = new CustomEvent<Detail>(COMPOSER_TEXT_EVENT, { detail: { conversationId, text }, cancelable: true });
  // Una caja que lo toma llama preventDefault: dispatchEvent devuelve false.
  return !window.dispatchEvent(event);
}

/**
 * La caja de escribir de `conversationId` recibe los textos que le mandan (el handler puede cambiar).
 * `accepts` = hay dónde escribir (con la ventana de 24 h cerrada no lo toma).
 */
export function useComposerTextRequests(conversationId: string, accepts: boolean, onText: (text: string) => void): void {
  const handler = useRef(onText);
  const enabled = useRef(accepts);
  useEffect(() => {
    handler.current = onText;
    enabled.current = accepts;
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as Partial<Detail> | null;
      if (!enabled.current || !detail || detail.conversationId !== conversationId || typeof detail.text !== "string" || !detail.text) return;
      event.preventDefault();
      handler.current(detail.text);
    };
    window.addEventListener(COMPOSER_TEXT_EVENT, listener);
    return () => window.removeEventListener(COMPOSER_TEXT_EVENT, listener);
  }, [conversationId]);
}
