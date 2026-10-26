"use client";

// Marco de las ventanas de «Datos personales» del Detalle (ARCO): «Exportar datos» (26-oct-2026) y «Borrar
// contacto» (7-oct-2026). Va en un portal encima de todo (también del pop-up del Embudo y del Detalle a
// pantalla completa del celular); Esc o el fondo la cierran sin cerrar lo de abajo y el foco regresa a quien la
// abrió. Sin lógica de datos: el contenido y los botones los pone cada ventana.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseX } from "@/components/ui/close-x";

export function ArcoDialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  /** Cerrar (Esc, fondo, ✕). Quien la usa decide si se puede (p. ej. no mientras borra). */
  onClose: () => void;
  children: React.ReactNode;
  /** Botones de abajo a la derecha. */
  footer: React.ReactNode;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  // Esc cierra SOLO esta ventana: se atiende antes que el pop-up del Embudo (que también escucha Esc).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Cerrar" tabIndex={-1} onClick={() => closeRef.current()} className="absolute inset-0 bg-black/40" />
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-md space-y-3 rounded-t-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold break-words">
            {title}
          </h2>
          <CloseX label="Cerrar" onClick={() => closeRef.current()} />
        </div>
        {children}
        <div className="flex justify-end gap-2 pt-1">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
