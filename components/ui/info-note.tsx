"use client";

// Nota de «cómo se calcula» que se abre con un clic (20-nov-2026, Dashboard opción A del dueño): las explicaciones
// largas de las tarjetas ya no ocupan espacio fijo. Un botón (no un tooltip) para que también abra en el celular.
import { Info } from "lucide-react";
import { useState, type ReactNode } from "react";

export function InfoNote({ children, label = "Cómo se calcula" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
      >
        <Info className="size-3.5" aria-hidden="true" />
        {label}
      </button>
      {open && <p className="mt-1 text-xs text-muted-foreground">{children}</p>}
    </div>
  );
}
