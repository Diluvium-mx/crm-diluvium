"use client";

// Interruptor «Lista / Cuadrícula» arriba a la derecha (el de 📄 Plantillas del chat, 26-oct-2026 también en
// ⚡ Mensajes rápidos y en su sección). Quien lo usa recuerda la vista con usePersistentToggle. Sin lógica.
import { LayoutGrid, List } from "lucide-react";

export function ViewToggle({ grid, onChange, label }: { grid: boolean; onChange: (grid: boolean) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="ml-auto flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5">
      {([false, true] as const).map((isGrid) => {
        const Icon = isGrid ? LayoutGrid : List;
        const name = isGrid ? "Cuadrícula" : "Lista";
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={grid === isGrid}
            aria-label={name}
            title={name}
            onClick={() => onChange(isGrid)}
            className={`rounded p-1 ${grid === isGrid ? "bg-card text-brand-navy shadow-sm dark:text-sky-300" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
