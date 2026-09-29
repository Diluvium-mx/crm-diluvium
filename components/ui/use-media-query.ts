"use client";

import { useSyncExternalStore } from "react";

// ¿La ventana cumple esta media query? Sin salto al hidratar: en el servidor (y en el
// primer pintado del cliente) vale `false`, y en cuanto React hidrata se lee el valor
// real y se vuelve a pintar. Solo para lo que no se puede resolver con clases (p. ej.
// un texto distinto en móvil); el layout se decide con `hidden md:flex`.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Pantalla angosta (< md de Tailwind, 768 px): la versión móvil. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
