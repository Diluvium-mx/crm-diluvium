"use client";

import { useEffect, useRef, useState } from "react";
import { getContactFullName, type Contact, type Stage, type Temperature } from "../_data/types";
import { ContactChat } from "./contact-chat";
import { ContactDetails } from "./contact-details";

export function ContactDetailPanel({
  contact,
  isSaving,
  onClose,
  onStageChange,
  onTemperatureChange,
}: {
  contact: Contact;
  isSaving: boolean;
  onClose: () => void;
  onStageChange: (stage: Stage) => void;
  onTemperatureChange: (temperature: Temperature | null) => void;
}) {
  // a11y del modal: cerrar con Escape, enfocar el panel al abrir y devolver el
  // foco al elemento disparador al cerrar. (Trap de foco completo queda como
  // mejora futura; esto cubre lo esencial para uso con teclado.)
  const panelRef = useRef<HTMLDivElement>(null);

  // Cierre con animacion de salida: se marca "cerrando" para reproducir el
  // fade/zoom-out y, al terminar (~180ms), se avisa al padre que desmonte.
  const [isClosing, setIsClosing] = useState(false);
  const requestClose = () => setIsClosing(true);

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
      if (event.key === "Escape") {
        setIsClosing(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        className={`relative flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-background shadow-xl outline-none duration-200 ease-out motion-reduce:animate-none md:flex-row ${
          isClosing ? "animate-out fade-out-0 zoom-out-95" : "animate-in fade-in-0 zoom-in-95"
        }`}
      >
        {/* Panel izquierdo: el MISMO chat de la bandeja, resuelto por contacto.
            Su encabezado (nombre/teléfono/etapa) lo pone ChatThread; el título
            accesible del diálogo va oculto para lectores de pantalla. */}
        <section className="flex min-h-0 flex-1 flex-col border-b md:border-b-0 md:border-r">
          <h2 id="contact-detail-title" className="sr-only">
            Conversación con {getContactFullName(contact)}
          </h2>
          <ContactChat contactId={contact.id} />
        </section>

        {/* Panel derecho: el MISMO "Detalle del contacto" de la Bandeja (B2). */}
        <aside className="flex h-1/2 min-h-0 w-full shrink-0 flex-col md:h-auto md:w-80">
          <ContactDetails
            contactId={contact.id}
            name={getContactFullName(contact)}
            phone={contact.phoneE164}
            stage={contact.stage}
            temperature={contact.temperature}
            onStageChange={onStageChange}
            onTemperatureChange={onTemperatureChange}
            busy={isSaving}
            action={
              <button type="button" onClick={requestClose} className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
                Cerrar
              </button>
            }
          />
        </aside>
      </div>
    </div>
  );
}
