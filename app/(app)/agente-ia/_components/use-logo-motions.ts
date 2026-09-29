"use client";

// Sortea el movimiento de cada logo de Agente IA › Modelos una vez por visita a la página
// (lib/ai/logo-motions.ts) y lo guarda en el navegador para que la próxima vez cada marca
// cambie. Sin almacenamiento (modo privado, bloqueado) igual sortea, solo que sin recordar.
// useSyncExternalStore (como components/ui/use-persistent-toggle.ts): en el servidor y al
// hidratar vale null (sin movimiento); en cuanto hidrata, React vuelve a pintar con el
// sorteo. El sorteo se guarda aquí mientras la página esté abierta y se descarta al salir
// de ella, así la siguiente visita (o recarga) sortea de nuevo.
import { useSyncExternalStore } from "react";
import { assignLogoMotions, LOGO_MOTIONS_STORAGE_KEY, parseLogoMotions, type LogoMotions } from "@/lib/ai/logo-motions";

let current: LogoMotions | null = null;
let subscribers = 0;

// Sortea una sola vez por visita: las siguientes lecturas devuelven lo mismo.
function draw(): LogoMotions {
  if (current) return current;
  let previous: LogoMotions = {};
  try {
    previous = parseLogoMotions(window.localStorage.getItem(LOGO_MOTIONS_STORAGE_KEY));
  } catch {
    // sin almacenamiento: sin sorteo anterior
  }
  current = assignLogoMotions(previous);
  try {
    window.localStorage.setItem(LOGO_MOTIONS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // sin almacenamiento: no se recuerda para la próxima
  }
  return current;
}

// Se descarta un momento después de salir, no en el acto: React (en desarrollo) desmonta
// y vuelve a montar de inmediato, y eso no debe contar como otra visita ni volver a sortear.
function subscribe(): () => void {
  subscribers++;
  return () => {
    subscribers--;
    setTimeout(() => {
      if (subscribers === 0) current = null;
    }, 0);
  };
}

export function useLogoMotions(): LogoMotions | null {
  return useSyncExternalStore(subscribe, draw, () => null);
}
