"use client";

// Indicador de temperatura en la fila de la Bandeja (C1), debajo de la
// estrella: muestra el emoji y, al hacer clic, deja cambiarla SIN abrir el
// chat. El menú va en un PORTAL (DropdownMenu de Base UI): las filas de la
// lista virtualizada llevan transform, y un menú dentro de la fila quedaba
// debajo de las filas siguientes (el clic abría otra conversación) o recortado
// por el scroll.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const current = isTemperature(value) ? value : null;

  function choose(next: Temperature | null) {
    if (next !== current) onChange(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={current ? `Temperatura: ${TEMPERATURE_LABELS[current]}. Cambiar` : "Asignar temperatura"}
        title={current ? TEMPERATURE_LABELS[current] : "Asignar temperatura"}
        className={`flex size-6 items-center justify-center rounded text-sm leading-none transition-colors hover:bg-muted ${
          current ? "" : "text-muted-foreground/60"
        }`}
      >
        {current ? TEMPERATURE_EMOJI[current] : <span aria-hidden="true" className="text-xs">○</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {TEMPERATURES.map((t) => (
          <DropdownMenuItem key={t} onClick={() => choose(t)} className={current === t ? "font-medium" : ""}>
            <span aria-hidden="true">{TEMPERATURE_EMOJI[t]}</span>
            {TEMPERATURE_LABELS[t]}
            {current === t && <span className="sr-only"> (actual)</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => choose(null)} className="text-muted-foreground">
          <span aria-hidden="true">○</span>
          Sin asignar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
