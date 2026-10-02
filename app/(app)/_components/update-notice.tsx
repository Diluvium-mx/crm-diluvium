"use client";

// Aviso «Hay una nueva actualización del CRM: recarga la página» (1-oct-2026, decisión del
// dueño: estilo «En la barra»). Sale SOLO cuando falló algo que hizo el vendedor y el servidor
// ya tiene otra versión que esta pestaña (lib/version/client.ts); nunca por haber versión nueva
// sin falla ni por un refresco automático. Se queda hasta recargar: con la pestaña vieja todo
// seguiría fallando.
// Va DENTRO de la barra de arriba (layout.tsx): en escritorio es una píldora entre el logo y
// el correo; en celular no cabe y baja como franja azul pegada debajo de la barra (flota: la
// barra conserva su alto de 4rem, del que dependen la Bandeja y el Embudo).
import { useSyncExternalStore } from "react";
import { RotateCw } from "lucide-react";
import { hayActualizacion, suscribir } from "@/lib/version/client";
import { MENSAJE_ACTUALIZACION } from "@/lib/version/rules";

function Recargar({ className }: { className: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={`shrink-0 bg-brand-orange font-semibold text-brand-white hover:bg-brand-orange-light ${className}`}
    >
      Recargar
    </button>
  );
}

export function UpdateNotice() {
  const visible = useSyncExternalStore(suscribir, hayActualizacion, () => false);
  if (!visible) return null;
  return (
    <>
      {/* data-aviso-version: mientras se ve, la cinta del clima cede el centro (globals.css). */}
      <div data-aviso-version="" className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
        <div
          role="status"
          aria-live="polite"
          className="flex min-w-0 max-w-[560px] items-center gap-2.5 rounded-full border border-white/30 bg-white/12 py-1 pr-1 pl-3.5 text-[13px] leading-tight text-brand-white duration-200 ease-out animate-in fade-in-0 slide-in-from-top-2 motion-reduce:animate-none"
        >
          <RotateCw className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{MENSAJE_ACTUALIZACION}</span>
          <Recargar className="rounded-full px-3 py-1.5" />
        </div>
      </div>
      <div
        role="status"
        aria-live="polite"
        className="absolute inset-x-0 top-full flex items-center gap-2.5 border-t border-white/15 bg-brand-navy-dark px-3 py-2 text-[13px] leading-snug text-brand-white shadow-[0_6px_18px_-8px_rgb(4_30_60/0.55)] duration-200 ease-out animate-in fade-in-0 slide-in-from-top-2 motion-reduce:animate-none md:hidden"
      >
        <RotateCw className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{MENSAJE_ACTUALIZACION}</span>
        <Recargar className="rounded-md px-3 py-1.5" />
      </div>
    </>
  );
}
