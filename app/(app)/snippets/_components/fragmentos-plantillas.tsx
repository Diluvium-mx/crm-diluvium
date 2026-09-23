"use client";

// Sección "Mensajes rápidos": Fragmentos + Plantillas (2ª mitad de la Fase 2).
// - Fragmentos ⚡ (naranja de acción): texto libre editable, para DENTRO de la
//   ventana de 24 h; se crean/editan/borran aquí, con variables {{nombre}}.
// - Plantillas 📄 (azul estructural): aprobadas por Meta, para FUERA de la
//   ventana; solo se listan y envían (el alta/edición vive en Meta o el alta por
//   API queda en revisión). Ver docs/investigacion/plantillas-zernio.md.
import { useState } from "react";
import type { SnippetView } from "@/lib/snippets/types";
import type { TemplateView } from "@/lib/templates/types";
import { FragmentosTab } from "./fragmentos-tab";
import { PlantillasTab } from "./plantillas-tab";

type Tab = "fragmentos" | "plantillas";

export function FragmentosPlantillas({
  initialSnippets,
  initialTemplates,
  canManageSnippets,
  canManageTemplates,
}: {
  initialSnippets: SnippetView[];
  initialTemplates: TemplateView[];
  canManageSnippets: boolean;
  canManageTemplates: boolean;
}) {
  const [tab, setTab] = useState<Tab>("fragmentos");

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="text-sm font-semibold">Mensajes rápidos</h1>
        <div role="tablist" aria-label="Fragmentos o plantillas" className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
          <button
            role="tab"
            aria-selected={tab === "fragmentos"}
            onClick={() => setTab("fragmentos")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "fragmentos"
                ? "bg-brand-orange text-brand-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ⚡ Fragmentos
          </button>
          <button
            role="tab"
            aria-selected={tab === "plantillas"}
            onClick={() => setTab("plantillas")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "plantillas"
                ? "bg-brand-navy text-brand-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            📄 Plantillas
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "fragmentos" ? (
          <FragmentosTab initial={initialSnippets} canManage={canManageSnippets} />
        ) : (
          <PlantillasTab initial={initialTemplates} canManage={canManageTemplates} />
        )}
      </div>
    </div>
  );
}
