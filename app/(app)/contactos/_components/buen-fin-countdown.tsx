"use client";

import { useSyncExternalStore } from "react";
import { Timer } from "lucide-react";

// Temporizador de la columna temporal «Buen Fin» (3-nov-2026, dueño): cuenta hasta que termina el último
// día del Buen Fin, martes 17 de noviembre de 2026 a las 23:59:59 hora de Mazatlán (UTC−7 todo el año).
// Se quita junto con la columna cuando termine la campaña.
const FIN_SEGUNDOS = Date.parse("2026-11-17T23:59:59-07:00") / 1000;

// El segundo actual, una vez por segundo. En el servidor no hay hora: el temporizador sale al hidratar.
function useSegundo(): number | null {
  return useSyncExternalStore(
    (onChange) => {
      const t = setInterval(onChange, 1000);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
}

const dos = (n: number) => String(n).padStart(2, "0");

/** «13d 07:42:10» con los segundos que faltan para el fin; «Terminó» al llegar a cero. */
export function textoFaltan(ahoraSegundos: number): string {
  const faltan = Math.max(0, FIN_SEGUNDOS - ahoraSegundos);
  if (faltan === 0) return "Terminó";
  const dias = Math.floor(faltan / 86400);
  const horas = Math.floor((faltan % 86400) / 3600);
  const minutos = Math.floor((faltan % 3600) / 60);
  return `${dias}d ${dos(horas)}:${dos(minutos)}:${dos(faltan % 60)}`;
}

export function BuenFinCountdown() {
  const ahora = useSegundo();
  if (ahora === null) return null;
  const texto = textoFaltan(ahora);
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-white/90"
      title="El Buen Fin termina el martes 17 de noviembre a las 23:59 (hora de Mazatlán)"
    >
      <Timer className="size-3.5" aria-hidden="true" />
      {texto}
    </span>
  );
}
