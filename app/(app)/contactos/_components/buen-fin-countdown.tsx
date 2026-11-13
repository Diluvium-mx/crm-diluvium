"use client";

import { useSyncExternalStore } from "react";
import { Timer } from "lucide-react";

// Temporizador de la columna temporal «Buen Fin» (3-nov-2026, dueño; en dos fases desde el 4-nov). Antes del Buen
// Fin cuenta lo que falta para que empiece (viernes 13 de noviembre de 2026 a las 00:00) y, durante sus seis días (el 13-nov-2026 el dueño lo alargó un día),
// lo que falta para que termine (miércoles 18 a las 23:59:59, o sea el jueves 19 a las 00:00). Hora de Mazatlán
// (UTC−7 todo el año). Se quita junto con la columna cuando termine la campaña.
const INICIO_SEGUNDOS = Date.parse("2026-11-13T00:00:00-07:00") / 1000;
const FIN_SEGUNDOS = Date.parse("2026-11-19T00:00:00-07:00") / 1000;

export type FaseBuenFin = "antes" | "durante" | "termino";

// El segundo actual, una vez por segundo. En el servidor no hay hora: el tiempo sale al hidratar.
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

function duracion(segundos: number): string {
  const dias = Math.floor(segundos / 86400);
  const horas = Math.floor((segundos % 86400) / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  return `${dias}d ${dos(horas)}:${dos(minutos)}:${dos(segundos % 60)}`;
}

/** En qué fase va el Buen Fin y cuánto falta («8d 13:08:02»); sin tiempo cuando ya terminó. */
export function temporizador(ahoraSegundos: number): { fase: FaseBuenFin; tiempo: string | null } {
  if (ahoraSegundos < INICIO_SEGUNDOS) return { fase: "antes", tiempo: duracion(INICIO_SEGUNDOS - ahoraSegundos) };
  if (ahoraSegundos < FIN_SEGUNDOS) return { fase: "durante", tiempo: duracion(FIN_SEGUNDOS - ahoraSegundos) };
  return { fase: "termino", tiempo: null };
}

const ETIQUETA: Record<FaseBuenFin, string> = {
  antes: "Empieza en",
  durante: "En curso · termina en",
  termino: "Terminó el Buen Fin",
};

/** Renglón del temporizador debajo del nombre, dentro de la barra roja. */
export function BuenFinCountdown() {
  const ahora = useSegundo();
  const t = ahora === null ? null : temporizador(ahora);
  return (
    <div
      className="flex items-center justify-between gap-2 bg-red-600 px-3 pb-2 text-xs text-white"
      title="El Buen Fin va del viernes 13 al miércoles 18 de noviembre (hora de Mazatlán)"
    >
      {t === null ? (
        // Mismo alto antes de hidratar, para que la columna no brinque.
        <span className="invisible text-sm">0</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5 text-white/90">
            {t.fase === "durante" ? (
              <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
            ) : (
              <Timer className="size-3.5" aria-hidden="true" />
            )}
            {ETIQUETA[t.fase]}
          </span>
          {t.tiempo && <span className="text-sm font-semibold tabular-nums">{t.tiempo}</span>}
        </>
      )}
    </div>
  );
}
