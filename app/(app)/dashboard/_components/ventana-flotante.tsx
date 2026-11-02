"use client";

// Ventanas que flotan sobre el chat y salen de su botón (30/31-oct y 2-nov-2026, decisiones del dueño medidas en
// notas/robot-mirada/velocidad.html). Empezó con la ventana del seguimiento: «Sale de la píldora», abre en 310 ms y cierra
// en 260 ms, como las burbujas de Mac que salen de un botón (nace en su botón con un pequeño rebote; al cerrar se encoge
// hacia él y se desvanece; si se vuelve a abrir a medio cerrar, sigue desde donde iba) y «flota sobre el chat»: va encima
// del historial, justo arriba de la caja para escribir, sin empujar nada (antes iba dentro de la caja blanca del composer,
// que crecía y se encogía de golpe y los mensajes brincaban). El 2-nov-2026 lo mismo para ⚡ Mensajes rápidos, 📄
// Plantillas y 📎 Multimedia. Solo movimiento: lo de adentro es de cada ventana. El composer que las contiene lleva
// `relative`; cada botón de origen lleva `data-ventana-origen`. Con «reducir movimiento» aparecen y se van de golpe.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const VENTANA_ABRE_MS = 310;
export const VENTANA_CIERRA_MS = 260;

/** De qué botón sale cada ventana (el atributo `data-ventana-origen` de ese botón). */
export type OrigenVentana = "seguimiento" | "rapidos" | "plantillas" | "adjuntar";

// Cuadros de cerrar; abrir es el mismo camino al revés, con la misma curva: al revés arranca rápido y frena al llegar.
const CUADROS: Keyframe[] = [
  { opacity: 1, transform: "none" },
  { opacity: 1, transform: "scale(1.03)", offset: 0.25 },
  { opacity: 0, transform: "scale(0.2)" },
];
const CURVA = "cubic-bezier(.4,0,1,1)";

/** El centro del botón de origen a la vista (la píldora va en otro lugar en el celular), desde la esquina de la ventana. */
function centroDelBoton(ventana: HTMLElement, origen: OrigenVentana): string {
  const botones = ventana.parentElement?.querySelectorAll<HTMLElement>(`[data-ventana-origen="${origen}"]`) ?? [];
  const boton = [...botones].find((b) => b.getClientRects().length > 0);
  if (!boton) return "50% 100%";
  const b = boton.getBoundingClientRect();
  const v = ventana.getBoundingClientRect();
  return `${b.left + b.width / 2 - v.left}px ${b.top + b.height / 2 - v.top}px`;
}

/**
 * Una ventana que se cierra regresa a su botón antes de quitarse: mientras tanto sigue montada con `cerrando`. Si al
 * cerrarse (o mientras se cierra) se abre otra ventana flotante, se quita de golpe: la nueva ocupa su lugar.
 */
export function useSalida(abierta: boolean, otraAbierta: boolean): { montada: boolean; cerrando: boolean; alCerrar: () => void } {
  const [cerrando, setCerrando] = useState(false);
  const [antes, setAntes] = useState(abierta);
  if (antes !== abierta) {
    setAntes(abierta);
    setCerrando(!abierta && !otraAbierta);
  } else if (cerrando && otraAbierta) {
    setCerrando(false);
  }
  return { montada: abierta || cerrando, cerrando: !abierta && cerrando, alCerrar: () => setCerrando(false) };
}

export function VentanaFlotante({ origen, cerrando, onCerrada, children }: { origen: OrigenVentana; cerrando: boolean; onCerrada: () => void; children: ReactNode }) {
  const ventana = useRef<HTMLDivElement>(null);
  const alCerrar = useRef(onCerrada);
  useEffect(() => {
    alCerrar.current = onCerrada;
  });
  // Qué tanto llevaba la animación anterior (0 a 1) cuando se interrumpió: la siguiente sigue desde el mismo cuadro.
  const llevaba = useRef<number | null>(null);

  // Antes de pintar: la ventana nunca se ve completa un instante antes de salir de su botón.
  useLayoutEffect(() => {
    const el = ventana.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (cerrando) alCerrar.current();
      return;
    }
    el.style.transformOrigin = centroDelBoton(el, origen);
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
  }, [cerrando, origen]);

  // Encima del historial, a lo ancho de la caja para escribir (el mb-2 de cada ventana la separa de la orilla). Mientras
  // regresa a su botón ya no se puede tocar nada adentro.
  return (
    <div ref={ventana} className={`absolute inset-x-3 bottom-full z-20 ${cerrando ? "pointer-events-none" : ""}`}>
      {children}
    </div>
  );
}
