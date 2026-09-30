"use client";

// Menú del 📎 (30-sep-2026): dos opciones que se abren hacia arriba del botón.
// «Adjunta +» abre los archivos del equipo (lo de siempre); «Multimedia» abre
// las fotos y videos de la Biblioteca. Soltar archivos y pegar con Cmd+V siguen
// yendo directo, sin este menú. Se cierra con Esc o al tocar fuera.
import { useEffect, useRef } from "react";
import { ImagePlay, Paperclip } from "lucide-react";

export function AttachMenu({
  open,
  onToggle,
  onClose,
  onPickFiles,
  onMultimedia,
  className = "",
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPickFiles: () => void;
  onMultimedia: () => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const option = "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium hover:bg-brand-navy/10";
  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Adjuntar"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Adjuntar archivos o mandar de la Biblioteca"
        className={`rounded-md border px-2.5 py-2 text-brand-navy transition-colors dark:text-sky-300 ${
          open ? "border-brand-navy bg-brand-navy/10" : "hover:bg-brand-navy/10"
        }`}
      >
        <Paperclip className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Adjuntar" className="absolute bottom-full left-0 z-20 mb-1.5 w-48 overflow-hidden rounded-lg border bg-background shadow-md">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onPickFiles();
            }}
            className={option}
          >
            <Paperclip className="size-4 text-brand-navy dark:text-sky-300" aria-hidden="true" />
            Adjunta +
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onMultimedia();
            }}
            className={`${option} border-t`}
          >
            <ImagePlay className="size-4 text-brand-navy dark:text-sky-300" aria-hidden="true" />
            Multimedia
          </button>
        </div>
      )}
    </div>
  );
}
