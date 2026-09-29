"use client";

// Filtro por temperatura y «Destacado» (28-sep-2026): un ícono chico a la derecha del
// buscador de la Bandeja y del Embudo. Abre un menú corto: una temperatura a la vez
// (🔥 🧊 ⏳ ○ o Todas) y, donde se pide, el interruptor ⭐ Destacado (en la Bandeja no:
// ahí Destacado ya es la pestaña). Con algo elegido el ícono se pinta naranja y muestra
// el emoji; la × de al lado lo quita de un clic. Reglas: lib/contacts/filters.ts.
import { ListFilter, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isTemperatureFilter, type TemperatureFilter } from "@/lib/contacts/filters";
import { TEMPERATURE_EMOJI, TEMPERATURE_LABELS } from "../contactos/_data/types";

const ALL = "all";

const OPTIONS: { value: TemperatureFilter; emoji: string; label: string }[] = [
  { value: "caliente", emoji: TEMPERATURE_EMOJI.caliente, label: TEMPERATURE_LABELS.caliente },
  { value: "frio", emoji: TEMPERATURE_EMOJI.frio, label: TEMPERATURE_LABELS.frio },
  { value: "en_espera", emoji: TEMPERATURE_EMOJI.en_espera, label: TEMPERATURE_LABELS.en_espera },
  { value: "none", emoji: "○", label: "Sin asignar" },
];

function emojiFor(value: TemperatureFilter): string {
  return OPTIONS.find((o) => o.value === value)?.emoji ?? "";
}

export function CardFilterButton({
  temperature,
  onTemperatureChange,
  destacado,
  onDestacadoChange,
}: {
  temperature: TemperatureFilter | null;
  onTemperatureChange: (next: TemperatureFilter | null) => void;
  /** Interruptor ⭐ Destacado dentro del menú (Embudo). Sin `onDestacadoChange` no se ofrece. */
  destacado?: boolean;
  onDestacadoChange?: (next: boolean) => void;
}) {
  const withDestacado = onDestacadoChange !== undefined;
  const active = temperature !== null || (withDestacado && destacado === true);
  const summary = [temperature ? emojiFor(temperature) : "", withDestacado && destacado ? TEMPERATURE_EMOJI.destacado : ""]
    .filter(Boolean)
    .join(" ");
  const description = [
    temperature ? (OPTIONS.find((o) => o.value === temperature)?.label ?? "") : "",
    withDestacado && destacado ? "Destacado" : "",
  ]
    .filter(Boolean)
    .join(" + ");

  function clear() {
    onTemperatureChange(null);
    onDestacadoChange?.(false);
  }

  return (
    <div className="flex shrink-0 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={active ? `Filtro: ${description}. Cambiar` : "Filtrar por temperatura"}
          title={active ? `Filtro: ${description}` : "Filtrar"}
          data-active={active ? "" : undefined}
          className={`flex h-9 items-center gap-1 rounded-md border px-2 text-sm leading-none transition-colors hover:bg-muted ${
            active ? "border-brand-orange text-brand-orange" : "text-muted-foreground"
          }`}
        >
          <ListFilter className="size-4" aria-hidden="true" />
          {summary && <span aria-hidden="true">{summary}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup
            value={temperature ?? ALL}
            onValueChange={(value) => onTemperatureChange(isTemperatureFilter(value) ? value : null)}
          >
            {/* La etiqueta va DENTRO del grupo: Base UI la exige dentro de Group/RadioGroup. */}
            <DropdownMenuLabel>Temperatura</DropdownMenuLabel>
            {/* closeOnClick: en Base UI las opciones de radio/casilla dejan el menú abierto;
                aquí se elige una cosa y se cierra. */}
            <DropdownMenuRadioItem value={ALL} closeOnClick>
              Todas
            </DropdownMenuRadioItem>
            {OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                <span aria-hidden="true">{option.emoji}</span>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {withDestacado && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={destacado === true} onCheckedChange={(checked) => onDestacadoChange(checked)} closeOnClick>
                <span aria-hidden="true">{TEMPERATURE_EMOJI.destacado}</span>
                Destacado
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {active && (
        <button
          type="button"
          onClick={clear}
          aria-label="Quitar filtro"
          title="Quitar filtro"
          className="ml-0.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
