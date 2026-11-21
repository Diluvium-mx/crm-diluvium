"use client";

// Tarjeta chica de un costo del Dashboard (20-nov-2026, opción A del dueño): la cifra del mes y una línea; con un
// clic se abre debajo la tarjeta completa (a todo el ancho) y con otro se cierra; solo la flecha (21-nov-2026, el
// dueño quitó «Desglosar/Ocultar»: la acción se entiende sola). 21-nov-2026 (dueño):
// todo comprimido — al entrar todas cerradas y UNA sola abierta a la vez (abrir otra cierra la anterior); cuál quedó
// abierta se recuerda en esta computadora. Va dentro de una cuadrícula `grid-flow-row-dense`: las demás tarjetas chicas
// siguen en su fila. Sin lógica de datos: recibe el resumen (lib/dashboard/costo-tiles.ts) y la tarjeta completa.
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { TileResumen } from "@/lib/dashboard/costo-tiles";
import { usePersistentChoice } from "@/components/ui/use-persistent-choice";

// Una sola clave para las cuatro: guarda el id de la que está abierta (vacío = ninguna).
export const COST_TILE_KEY = "dashboard.costos";

export function CostTile({ id, title, summary, children }: { id: string; title: string; summary: TileResumen; children: ReactNode }) {
  const [abierta, setAbierta] = usePersistentChoice(COST_TILE_KEY, null);
  const open = abierta === id;
  const panelId = `costo-${id}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(open ? null : id)}
        aria-expanded={open}
        aria-label={`${open ? "Ocultar" : "Desglosar"} ${title}`}
        aria-controls={open ? panelId : undefined}
        data-link="card"
        className={`flex flex-col rounded-lg border bg-card p-3 text-left ${open ? "border-brand-navy-dark ring-1 ring-brand-navy-dark" : ""}`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
        <span className="mt-1 text-2xl font-semibold tabular-nums">{summary.value}</span>
        <span className={`text-xs ${summary.tone === "orange" ? "font-semibold text-brand-orange" : "text-muted-foreground"}`}>{summary.sub}</span>
      </button>
      {open && (
        <div id={panelId} className="col-span-full">
          {children}
        </div>
      )}
    </>
  );
}
