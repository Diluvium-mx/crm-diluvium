"use client";

// La ventana del seguimiento sale de la píldora y regresa a ella (30-oct-2026, el dueño lo eligió y midió en
// notas/robot-mirada/velocidad.html: «Sale de la píldora», abre en 310 ms y cierra en 260 ms, como las burbujas de Mac
// que salen de un botón). Nace en la píldora con un pequeño rebote; al cerrar se encoge hacia ella y se desvanece. Si se
// vuelve a abrir a medio cerrar, sigue desde donde iba. Solo movimiento: lo de adentro es FollowUpPanel. Con «reducir
// movimiento» aparece y se va de golpe, como antes.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export const VENTANA_ABRE_MS = 310;
export const VENTANA_CIERRA_MS = 260;

// Cuadros de cerrar; abrir es el mismo camino al revés, con la misma curva: al revés arranca rápido y frena al llegar.
const CUADROS: Keyframe[] = [
  { opacity: 1, transform: "none" },
  { opacity: 1, transform: "scale(1.03)", offset: 0.25 },
  { opacity: 0, transform: "scale(0.2)" },
];
const CURVA = "cubic-bezier(.4,0,1,1)";

/** El centro de la píldora a la vista (hay una por tamaño de pantalla), medido desde la esquina de la ventana. */
function centroDeLaPildora(ventana: HTMLElement): string {
  const pildoras = ventana.parentElement?.querySelectorAll<HTMLElement>("[data-testid=followup-pill]") ?? [];
  const pildora = [...pildoras].find((p) => p.getClientRects().length > 0);
  if (!pildora) return "50% 100%";
  const p = pildora.getBoundingClientRect();
  const v = ventana.getBoundingClientRect();
  return `${p.left + p.width / 2 - v.left}px ${p.top + p.height / 2 - v.top}px`;
}

export function VentanaDePildora({ cerrando, onCerrada, children }: { cerrando: boolean; onCerrada: () => void; children: ReactNode }) {
  const ventana = useRef<HTMLDivElement>(null);
  const alCerrar = useRef(onCerrada);
  useEffect(() => {
    alCerrar.current = onCerrada;
  });
  // Qué tanto llevaba la animación anterior (0 a 1) cuando se interrumpió: la siguiente sigue desde el mismo cuadro.
  const llevaba = useRef<number | null>(null);

  // Antes de pintar: la ventana nunca se ve completa un instante antes de salir de la píldora.
  useLayoutEffect(() => {
    const el = ventana.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (cerrando) alCerrar.current();
      return;
    }
    el.style.transformOrigin = centroDeLaPildora(el);
    const duracion = cerrando ? VENTANA_CIERRA_MS : VENTANA_ABRE_MS;
    const anim = el.animate(CUADROS, { duration: duracion, easing: CURVA, direction: cerrando ? "normal" : "reverse", fill: cerrando ? "forwards" : "none" });
    if (llevaba.current !== null) anim.currentTime = (1 - llevaba.current) * duracion;
    llevaba.current = null;
    if (cerrando) anim.finished.then(() => alCerrar.current(), () => {});
    return () => {
      const t = anim.currentTime;
      if (typeof t === "number" && anim.playState === "running") llevaba.current = t / duracion;
      anim.cancel();
    };
  }, [cerrando]);

  // Mientras regresa a la píldora ya no se puede tocar nada adentro.
  return (
    <div ref={ventana} className={cerrando ? "pointer-events-none" : undefined}>
      {children}
    </div>
  );
}
