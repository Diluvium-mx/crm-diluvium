"use client";

// Lleva la luz del "fondo iluminado" (app/globals.css, superficies interactivas) a
// donde está el cursor o el dedo: fija --glow-x/--glow-y en el elemento interactivo
// bajo el puntero. Un solo listener delegado para todo el CRM (sin tocar páginas),
// a lo más una escritura por cuadro. Con "reducir movimiento" no hace nada: la luz
// queda centrada.
import { useEffect } from "react";

// Los mismos elementos que ilumina app/globals.css.
const INTERACTIVE =
  'button, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role^="menuitem"], [role="option"], summary, [data-glow]';

export function GlowPointer() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      const event = last;
      if (!event || reduce.matches || !(event.target instanceof Element)) return;
      const el = event.target.closest(INTERACTIVE);
      if (!(el instanceof HTMLElement)) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--glow-x", `${Math.round(event.clientX - rect.left)}px`);
      el.style.setProperty("--glow-y", `${Math.round(event.clientY - rect.top)}px`);
    };

    const onPointer = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    document.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerdown", onPointer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
