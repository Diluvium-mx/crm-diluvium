"use client";

import { useState } from "react";
import type { OpinionVista } from "@/lib/opiniones/vista";
import { SEGUIMIENTOS_SECTIONS, type SeguimientosSection } from "@/lib/seguimientos/sections";
import { OpinionPanel, type PermisosOpinion } from "./opinion-panel";

const tabId = (s: SeguimientosSection) => `seguimientos-tab-${s}`;
const panelId = (s: SeguimientosSection) => `seguimientos-panel-${s}`;

// Subpestañas de Seguimientos (mismo estilo que Agente IA); la elegida queda en
// ?seccion= para que un enlace o una recarga abran la misma.
export function SeguimientosPanel({
  seccionInicial,
  opiniones,
  googleUrl,
  puede,
}: {
  seccionInicial: SeguimientosSection;
  opiniones: OpinionVista[];
  googleUrl: string | null;
  puede: PermisosOpinion;
}) {
  const [seccion, setSeccion] = useState<SeguimientosSection>(seccionInicial);

  function elegir(next: SeguimientosSection) {
    setSeccion(next);
    const url = new URL(window.location.href);
    url.searchParams.set("seccion", next);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4 p-4">
      <div className="-mx-4 border-b border-black/10 px-4 dark:border-white/10">
        <div role="tablist" aria-label="Secciones de Seguimientos" className="flex min-w-0 flex-wrap gap-1">
          {SEGUIMIENTOS_SECTIONS.map((s) => {
            const selected = seccion === s.id;
            return (
              <button
                key={s.id}
                id={tabId(s.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId(s.id)}
                tabIndex={selected ? 0 : -1}
                onClick={() => elegir(s.id)}
                className={`flex shrink-0 items-center border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                  selected
                    ? "border-brand-navy font-medium text-foreground dark:border-sky-300"
                    : "border-transparent text-foreground/70 hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id={panelId("opinion")} aria-labelledby={tabId("opinion")} hidden={seccion !== "opinion"}>
        <OpinionPanel opiniones={opiniones} googleUrl={googleUrl} puede={puede} />
      </div>
    </div>
  );
}
