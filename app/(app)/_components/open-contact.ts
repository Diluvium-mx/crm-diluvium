// "Abrir este contacto en la Bandeja" desde fuera de ella (el aviso emergente de
// cambio de etapa). Con la Bandeja ya a la vista, se le avisa por un evento de la
// ventana (sin navegar ni recargar); desde otra sección, se navega a
// /dashboard?contacto=<id> y la Bandeja lo abre al montar.
import { useEffect, useRef } from "react";

const OPEN_CONTACT_EVENT = "crm:abrir-contacto";

export function requestOpenContact(contactId: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_CONTACT_EVENT, { detail: contactId }));
}

/** La Bandeja escucha los pedidos de abrir un contacto (el handler puede cambiar sin re-suscribir). */
export function useOpenContactRequests(onOpen: (contactId: string) => void): void {
  const handler = useRef(onOpen);
  useEffect(() => {
    handler.current = onOpen;
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === "string" && id) handler.current(id);
    };
    window.addEventListener(OPEN_CONTACT_EVENT, listener);
    return () => window.removeEventListener(OPEN_CONTACT_EVENT, listener);
  }, []);
}
