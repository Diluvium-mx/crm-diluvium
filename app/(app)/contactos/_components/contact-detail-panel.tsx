"use client";

import { useEffect, useRef, useState } from "react";
import { Info, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { usePersistentToggle } from "@/components/ui/use-persistent-toggle";
import type { FunnelSignal } from "@/lib/contacts/funnel-tone";
import { getContactFullName, type BoardContact, type Stage, type Temperature } from "../_data/types";
import { ContactChat } from "./contact-chat";
import { ContactDetails } from "./contact-details";
import { MarkReadButton } from "./mark-read-button";
import { CloseX } from "@/components/ui/close-x";

export function ContactDetailPanel({
  contact,
  signal,
  onMarkRead,
  isSaving,
  onClose,
  onStageChange,
  onTemperatureChange,
  onOpenContact,
}: {
  contact: BoardContact;
  /** Señal de la tarjeta (en vivo): decide si «Marcar como leído» tiene algo que apagar. */
  signal: FunnelSignal | undefined;
  onMarkRead: () => void;
  isSaving: boolean;
  onClose: () => void;
  onStageChange: (stage: Stage) => void;
  onTemperatureChange: (temperature: Temperature | null) => void;
  /** Abrir otro contacto (primer mensaje: el número ya es de otro contacto). */
  onOpenContact?: (contactId: string) => void;
}) {
  // a11y del modal: cerrar con Escape, enfocar el panel al abrir y devolver el
  // foco al elemento disparador al cerrar. (Trap de foco completo queda como
  // mejora futura; esto cubre lo esencial para uso con teclado.)
  const panelRef = useRef<HTMLDivElement>(null);

  // Cierre con animacion de salida: se marca "cerrando" para reproducir el
  // fade/zoom-out y, al terminar (~180ms), se avisa al padre que desmonte.
  const [isClosing, setIsClosing] = useState(false);
  const requestClose = () => setIsClosing(true);
  // Detalle del contacto visible (como la Bandeja). Se RECUERDA en esta
  // computadora: oculto sigue oculto al cambiar de contacto, recargar o al día siguiente.
  const [detailsOpen, setDetailsOpen] = usePersistentToggle("embudo.detalle");
  // Móvil (< md): como la Bandeja. El chat ocupa todo el pop-up y el Detalle del contacto
  // se abre ENCIMA, a pantalla completa, con (i) en el encabezado del chat; ✕ roja lo cierra.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    if (!isClosing) {
      return;
    }
    const timer = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(timer);
  }, [isClosing, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Con el foco en un campo, el primer Escape solo sale del campo (su blur
      // guarda o cancela la edición); el siguiente cierra el pop-up. Así no se
      // pierde lo tecleado ni se cierra al cancelar la edición de un comentario.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        panelRef.current?.contains(active) &&
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)
      ) {
        active.blur();
        return;
      }
      setIsClosing(true);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    // Móvil (< md): el pop-up ocupa TODA la pantalla (sin margen ni esquinas); desde md,
    // la ventana centrada de siempre.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4">
      <button
        type="button"
        aria-label="Cerrar detalle del contacto"
        onClick={requestClose}
        className={`absolute inset-0 bg-black/40 duration-200 motion-reduce:animate-none ${
          isClosing ? "animate-out fade-out-0" : "animate-in fade-in-0"
        }`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-detail-title"
        tabIndex={-1}
        className={`relative flex h-full w-full max-w-4xl flex-col overflow-hidden bg-background shadow-xl outline-none duration-200 ease-out motion-reduce:animate-none md:h-[80vh] md:flex-row md:rounded-lg ${
          isClosing ? "animate-out fade-out-0 zoom-out-95" : "animate-in fade-in-0 zoom-in-95"
        }`}
      >
        {/* Panel izquierdo: el MISMO chat de la bandeja, resuelto por contacto.
            Su encabezado (nombre/teléfono/etapa) lo pone ChatThread, con «Marcar como
            leído» a la derecha del nombre (solo aquí, no en la Bandeja); el título
            accesible del diálogo va oculto para lectores de pantalla. min-w-0: un
            texto largo no ensancha el chat ni empuja fuera el detalle. */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col border-b md:border-b-0 md:border-r">
          <h2 id="contact-detail-title" className="sr-only">
            Conversación con {getContactFullName(contact)}
          </h2>
          <ContactChat
            contactId={contact.id}
            phoneE164={contact.phoneE164}
            headerAction={
              <>
                <MarkReadButton signal={signal} onMarkRead={onMarkRead} />
                {/* Móvil: (i) abre el Detalle encima; ✕ roja cierra el pop-up. */}
                <button
                  type="button"
                  onClick={() => setMobileDetailOpen(true)}
                  aria-label="Ver detalle del contacto"
                  title="Detalle del contacto"
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
                >
                  <Info className="size-5" aria-hidden="true" />
                </button>
                <CloseX size="sm" label="Cerrar" onClick={requestClose} />
              </>
            }
            onOpenContact={onOpenContact}
          />
        </section>

        {/* Panel derecho: el MISMO "Detalle del contacto" de la Bandeja (B2), que se
            oculta y se muestra con el mismo botón que en la Bandeja. "Cerrar" (el
            pop-up) se ve siempre: en el encabezado del detalle o en la franja. */}
        {detailsOpen ? (
          <aside className="hidden min-h-0 w-80 shrink-0 flex-col md:flex">
            <ContactDetails
              key={contact.id}
              contactId={contact.id}
              name={getContactFullName(contact)}
              phone={contact.phoneE164}
              stage={contact.stage}
              temperature={contact.temperature}
              onStageChange={onStageChange}
              onTemperatureChange={onTemperatureChange}
              busy={isSaving}
              action={
                <>
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(false)}
                    aria-label="Ocultar detalle del contacto"
                    title="Ocultar panel"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <PanelRightClose className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={requestClose}
                    aria-label="Cerrar"
                    title="Cerrar"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </>
              }
            />
          </aside>
        ) : (
          <div className="hidden w-10 shrink-0 flex-col items-center gap-2 bg-card pt-2.5 md:flex">
            <button
              type="button"
              onClick={requestClose}
              aria-label="Cerrar"
              title="Cerrar"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              aria-label="Mostrar detalle del contacto"
              title="Mostrar panel"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PanelRightOpen className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Móvil: el MISMO Detalle del contacto, encima del chat, a pantalla completa (como la Bandeja). */}
        {mobileDetailOpen && (
          <div role="dialog" aria-modal="true" aria-label="Detalle del contacto" className="fixed inset-0 z-[60] flex flex-col bg-card md:hidden">
            <ContactDetails
              key={`movil-${contact.id}`}
              contactId={contact.id}
              name={getContactFullName(contact)}
              phone={contact.phoneE164}
              stage={contact.stage}
              temperature={contact.temperature}
              onStageChange={onStageChange}
              onTemperatureChange={onTemperatureChange}
              busy={isSaving}
              action={<CloseX always label="Cerrar detalle del contacto" onClick={() => setMobileDetailOpen(false)} />}
            />
          </div>
        )}
      </div>
    </div>
  );
}
