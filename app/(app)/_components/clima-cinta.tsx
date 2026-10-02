"use client";

// Cinta del clima de la barra de arriba (decisión del dueño, 1 y 2-oct-2026): corre siempre de derecha a
// izquierda y NADA la detiene ni la mueve (ni el mouse: no tiene globo ni reacciona al cursor). Solo en
// escritorio (≥ 768 px) y en horario de trabajo; reglas y datos en lib/clima/ (docs/clima.md).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { leerCintaClima } from "@/lib/clima/actions";
import type { IconoClima, ItemCinta } from "@/lib/clima/cinta";

const ICONOS: Record<IconoClima, LucideIcon> = {
  sol: Sun,
  luna: Moon,
  "nube-sol": CloudSun,
  "nube-luna": CloudMoon,
  nube: Cloud,
  niebla: CloudFog,
  llovizna: CloudDrizzle,
  lluvia: CloudRain,
  tormenta: CloudLightning,
};

const VELOCIDAD_PX_S = 40;
const CADA_MS = 10 * 60_000;
const DESVANECIDO = "linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 48px), transparent)";

function Lista({ items, copia }: { items: ItemCinta[]; copia?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={copia || undefined}>
      {items.map((c) => {
        const Icono = ICONOS[c.icono];
        return (
          <span key={c.nombre} className="flex items-center whitespace-nowrap">
            <span className="flex items-center gap-1.5 px-2.5 text-sm text-brand-white">
              <Icono className={`size-[18px] shrink-0 ${c.agua ? "text-brand-orange-light" : ""}`} aria-hidden="true" />
              <span className="sr-only">{c.palabra}</span>
              <span>{c.nombre}</span>
              <span className="font-semibold">{c.grados}</span>
              {c.mm && <span className="text-[#cfe0f2]">{c.mm}</span>}
            </span>
            <span className="px-1.5 text-white/35" aria-hidden="true">
              •
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function ClimaCinta({ inicial }: { inicial: ItemCinta[] }) {
  const [items, setItems] = useState(inicial);
  const [segundos, setSegundos] = useState<number | null>(null);
  const pista = useRef<HTMLDivElement>(null);

  // Cada 10 min (solo con la pestaña a la vista) se pregunta al servidor: así entra a las 9:00, sale a
  // las 19:00 y cambia a la hora nueva sin recargar. Solo se toca la cinta si algo cambió.
  useEffect(() => {
    let vigente = JSON.stringify(inicial);
    const timer = setInterval(() => {
      if (document.hidden) return;
      leerCintaClima()
        .then((nuevos) => {
          const texto = JSON.stringify(nuevos);
          if (texto === vigente) return;
          vigente = texto;
          setItems(nuevos);
        })
        .catch(() => {});
    }, CADA_MS);
    return () => clearInterval(timer);
  }, [inicial]);

  // La duración sale del ancho real para que la velocidad sea siempre la misma (40 px/s).
  useLayoutEffect(() => {
    const ancho = pista.current ? pista.current.scrollWidth / 2 : 0;
    setSegundos(ancho > 0 ? Math.round(ancho / VELOCIDAD_PX_S) : null);
  }, [items]);

  if (!items.length) return null;
  return (
    <div
      data-cinta-clima=""
      aria-label="Clima"
      className="pointer-events-none mx-2 hidden h-10 min-w-0 flex-1 select-none items-center overflow-hidden md:flex"
      style={{ maskImage: DESVANECIDO, WebkitMaskImage: DESVANECIDO }}
    >
      <div
        ref={pista}
        className="cinta-clima-pista flex w-max"
        data-corriendo={segundos ? "" : undefined}
        style={segundos ? { animationDuration: `${segundos}s` } : undefined}
      >
        <Lista items={items} />
        <Lista items={items} copia />
      </div>
    </div>
  );
}
