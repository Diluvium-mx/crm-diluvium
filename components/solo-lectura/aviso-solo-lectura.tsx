"use client";

// Aviso «Modo solo lectura» (26-nov-2026, decisión del dueño: aviso corto al
// presionar algo que guardaría). Solo se monta para el rol «Solo lectura» (app/(app)/layout.tsx).
// Mismo lugar que los avisos del CRM (TopNotice): abajo de la barra azul, centrado en el contenido.
// La lógica (cuándo sale, qué cajas no dejan escribir) vive en lib/auth/solo-lectura-navegador.ts.
import { useEffect, useSyncExternalStore } from "react";
import { Lock } from "lucide-react";
import { SOLO_LECTURA_MENSAJE } from "@/lib/auth/solo-lectura";
import { avisoVisible, instalarSoloLectura, suscribir } from "@/lib/auth/solo-lectura-navegador";

export function AvisoSoloLectura() {
  useEffect(() => {
    instalarSoloLectura();
  }, []);
  const visible = useSyncExternalStore(suscribir, avisoVisible, () => false);
  return (
    <>
      <p role="status" className="sr-only">
        {visible ? SOLO_LECTURA_MENSAJE : ""}
      </p>
      {visible && (
        <div className="pointer-events-none fixed top-[4.5rem] right-0 left-0 z-50 flex justify-center px-4 md:left-56">
          <div
            aria-hidden="true"
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-lg ring-1 ring-black/5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 dark:ring-white/10"
          >
            <Lock className="size-4 shrink-0 text-brand-navy dark:text-sky-300" />
            {SOLO_LECTURA_MENSAJE}
          </div>
        </div>
      )}
    </>
  );
}
