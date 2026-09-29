"use client";

// Temperatura + Destacado en el pop-up del Embudo (29-sep-2026, regla del dueño). En el
// Embudo no hay estrella como en la lista de la Bandeja, así que la sección Temperatura
// asigna las DOS cosas: arriba una temperatura (radio) y, abajo de la línea, ⭐ Destacado
// (casilla). Conviven: «🔥 Caliente ⭐». Mismo patrón que el filtro (card-filter-button).
// En la Bandeja el Detalle sigue con el selector simple, sin Destacado: ahí está la estrella.
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DESTACADO_EMOJI, TEMPERATURES, TEMPERATURE_EMOJI, TEMPERATURE_LABELS, type Temperature } from "../_data/types";

const NONE = "none";

function isAssignable(value: string): value is Temperature {
  return (TEMPERATURES as readonly string[]).includes(value);
}

export function TemperatureDestacadoMenu({
  temperature,
  destacado,
  disabled = false,
  onTemperatureChange,
  onDestacadoChange,
  className,
}: {
  temperature: Temperature | null;
  destacado: boolean;
  disabled?: boolean;
  onTemperatureChange: (next: Temperature | null) => void;
  onDestacadoChange: (next: boolean) => void;
  /** Mismas clases que los demás campos del Detalle. */
  className: string;
}) {
  // Un valor viejo que ya no se asigna (⭐ como temperatura) se ve como «Sin asignar».
  const current = temperature && isAssignable(temperature) ? temperature : null;
  const temperatureText = current ? `${TEMPERATURE_EMOJI[current]} ${TEMPERATURE_LABELS[current]}` : "Sin asignar";
  const summary = destacado ? `${temperatureText} ${DESTACADO_EMOJI}` : temperatureText;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Temperatura: ${current ? TEMPERATURE_LABELS[current] : "sin asignar"}${destacado ? ", Destacado" : ""}. Cambiar`}
        className={`${className} flex items-center justify-between gap-1 text-left disabled:opacity-60`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={current ?? NONE}
          onValueChange={(value) => {
            const next = typeof value === "string" && isAssignable(value) ? value : null;
            if (next !== current) onTemperatureChange(next);
          }}
        >
          {/* closeOnClick: en Base UI radio y casilla dejan el menú abierto. */}
          <DropdownMenuRadioItem value={NONE} closeOnClick>
            <span aria-hidden="true">○</span>
            Sin asignar
          </DropdownMenuRadioItem>
          {TEMPERATURES.map((t) => (
            <DropdownMenuRadioItem key={t} value={t} closeOnClick>
              <span aria-hidden="true">{TEMPERATURE_EMOJI[t]}</span>
              {TEMPERATURE_LABELS[t]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={destacado} onCheckedChange={(checked) => onDestacadoChange(checked)} closeOnClick>
          <span aria-hidden="true">{DESTACADO_EMOJI}</span>
          Destacado
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
