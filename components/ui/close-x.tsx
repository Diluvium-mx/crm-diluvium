"use client";

import { X } from "lucide-react";

// Botón de cerrar de la VERSIÓN MÓVIL (decisión del dueño, 28-sep-2026): una ✕ blanca
// dentro de un círculo rojo, grande para el dedo, en todo lo que se abre encima (menú,
// pop-ups, selectores del chat, visor de fotos, diálogos). En escritorio no se ve
// (md:hidden): ahí siguen la ✕ chica, "Cerrar" o Esc de siempre. `always` la deja
// siempre visible (para lo que ya es exclusivo de móvil).
export function CloseX({
  onClick,
  label = "Cerrar",
  always = false,
  size = "md",
  className = "",
}: {
  onClick: () => void;
  label?: string;
  always?: boolean;
  /** md = 40 px (pop-ups); sm = 32 px (encabezados angostos de los selectores del chat). */
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-no-glow=""
      className={`${always ? "flex" : "flex md:hidden"} ${size === "sm" ? "size-8" : "size-10"} shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-md transition-colors hover:bg-red-700 active:bg-red-800 ${className}`}
    >
      <X className={size === "sm" ? "size-4" : "size-5"} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
