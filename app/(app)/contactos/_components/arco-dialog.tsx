"use client";

// Marco de las ventanas de «Datos personales» del Detalle (ARCO): «Exportar datos» (26-oct-2026) y «Borrar
// contacto» (7-oct-2026); también la de «Hacer guía de envío» (27-oct-2026, `wide`: más ancha y con scroll).
// Va en un portal encima de todo (también del pop-up del Embudo y del Detalle a pantalla completa del
// celular); Esc o el fondo la cierran sin cerrar lo de abajo (la de formulario solo con ✕, Cancelar o Esc fuera
// de un campo) y el foco regresa a quien la abrió. Sin lógica de datos: el contenido y los botones los pone
// cada ventana.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseX } from "@/components/ui/close-x";

export function ArcoDialog({
  title,
  onClose,
  children,
  footer,
  titleExtra,
  wide = false,
}: {
  title: string;
  /** Algo junto al título (p. ej. la etiqueta «Prueba»). */
  titleExtra?: React.ReactNode;
  /** Ventana de formulario: más ancha, con scroll propio y `role="dialog"`. */
  wide?: boolean;
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

  // Esc cierra SOLO esta ventana: se atiende antes que el pop-up del Embudo (que también escucha Esc). En una
  // ventana de formulario (`wide`), Esc dentro de un campo es del campo (p. ej. cerrar la lista de colonias):
  // no se pierde lo escrito.
  const wideRef = useRef(wide);
  useLayoutEffect(() => {
    wideRef.current = wide;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (wideRef.current && event.target instanceof HTMLElement && event.target.closest("input, select, textarea")) return;
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
      {/* El fondo cierra, salvo en una ventana de formulario: un clic de más no borra lo escrito (✕ o Cancelar). */}
      <button
        type="button"
        aria-label="Cerrar"
        tabIndex={-1}
        onClick={() => {
          if (!wide) closeRef.current();
        }}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={boxRef}
        role={wide ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full space-y-3 rounded-t-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none sm:rounded-xl ${
          wide ? "max-h-[92dvh] max-w-xl overflow-y-auto" : "max-w-md"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id={titleId} className="text-base font-semibold break-words">
              {title}
            </h2>
            {titleExtra}
          </div>
          <CloseX label="Cerrar" onClick={() => closeRef.current()} />
        </div>
        {children}
        <div className="flex justify-end gap-2 pt-1">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
