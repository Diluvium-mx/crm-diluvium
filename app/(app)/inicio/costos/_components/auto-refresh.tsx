"use client";

// Vuelve a pedir la página cada cierto tiempo (Historial de costos, mes en curso: «en vivo»). Los cobros los lee el
// worker cada 5–60 min, así que más seguido no cambia nada. Solo mientras la pestaña está a la vista.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [router, everyMs]);
  return null;
}
