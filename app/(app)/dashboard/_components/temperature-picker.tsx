"use client";

// Indicador de temperatura en la fila de la Bandeja (C1), debajo de la
// estrella: muestra el emoji y, al hacer clic, deja cambiarla SIN abrir el
// chat (menú pequeño; Esc o clic fuera lo cierran).
import { useEffect, useRef, useState } from "react";
import {
  TEMPERATURES,
  TEMPERATURE_EMOJI,
  TEMPERATURE_LABELS,
  type Temperature,
} from "../../contactos/_data/types";

function isTemperature(value: string | null): value is Temperature {
  return value !== null && (TEMPERATURES as readonly string[]).includes(value);
}

export function TemperaturePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: Temperature | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = isTemperature(value) ? value : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: Temperature | null) {
    setOpen(false);
    if (next !== current) onChange(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `Temperatura: ${TEMPERATURE_LABELS[current]}. Cambiar` : "Asignar temperatura"}
        title={current ? TEMPERATURE_LABELS[current] : "Asignar temperatura"}
        className={`flex size-6 items-center justify-center rounded text-sm leading-none transition-colors hover:bg-muted ${
          current ? "" : "text-muted-foreground/60"
        }`}
      >
        {current ? TEMPERATURE_EMOJI[current] : <span aria-hidden="true" className="text-xs">○</span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border bg-popover py-1 text-sm shadow-md">
          {TEMPERATURES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={current === t}
              onClick={() => choose(t)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted ${current === t ? "font-medium" : ""}`}
            >
              <span aria-hidden="true">{TEMPERATURE_EMOJI[t]}</span>
              {TEMPERATURE_LABELS[t]}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={current === null}
            onClick={() => choose(null)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground hover:bg-muted"
          >
            <span aria-hidden="true">○</span>
            Sin asignar
          </button>
        </div>
      )}
    </div>
  );
}
