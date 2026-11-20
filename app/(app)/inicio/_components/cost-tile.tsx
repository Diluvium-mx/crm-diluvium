"use client";

// Tarjeta chica de un costo del Dashboard (20-nov-2026, opción A del dueño): la cifra del mes y una línea; al hacer
// clic se abre debajo la tarjeta completa (ocupa todo el ancho). Lo abierto o cerrado se recuerda en esta computadora.
// Va dentro de una cuadrícula `grid-flow-row-dense`: así las demás tarjetas chicas siguen en la misma fila aunque una
// esté abierta. Sin lógica de datos: recibe el resumen (lib/dashboard/costo-tiles.ts) y la tarjeta completa.
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { TileResumen } from "@/lib/dashboard/costo-tiles";
import { usePersistentToggle } from "@/components/ui/use-persistent-toggle";

export function CostTile({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  summary: TileResumen;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistentToggle(`dashboard.costos.${id}`, defaultOpen);
  const panelId = `costo-${id}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-link="card"
        className={`flex flex-col rounded-lg border bg-card p-3 text-left ${open ? "border-brand-navy-dark ring-1 ring-brand-navy-dark" : ""}`}
      >
        <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
          {title}
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
