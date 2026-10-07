"use client";

// Botón "Pausar agente" (25-sep-2026; textos del 26-sep): el vendedor pausa al Agente IA
// en ESTA conversación cuando toma a un buen prospecto; el agente sigue contestando
// todas las demás. Menú: 8/12/24 h, hasta una fecha y hora (Mazatlán) o pausar
// indefinidamente. Desde el 26-sep-2026 vive SOLO en "Detalle del contacto" (Bandeja y
// pop-up del Embudo), junto al estado; pausado, ahí mismo sale "Activar".
import { useRef, useState } from "react";
import { X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pauseAgent } from "@/lib/actions/agente-conversacion";
import { MAX_PAUSE_MS, PAUSE_OPTIONS, PAUSE_OPTION_LABELS, pauseUntil, type PauseOption } from "@/lib/agente-ia/pause";
import { instantToLocal } from "@/lib/scheduled/rules";
import { DateTimePicker } from "@/components/ui/date-time-picker";

// Propuesta inicial de la hora exacta: dentro de 1 h, redondeado a 5 minutos.
function defaultAt(): string {
  const step = 5 * 60_000;
  return instantToLocal(new Date(Math.ceil((Date.now() + 60 * 60_000) / step) * step));
}

// Límites del selector al abrirlo: de 1 minuto a 30 días (el servidor valida la hora real).
function pickerLimits(): { min: string; max: string } {
  const now = Date.now();
  return { min: instantToLocal(new Date(now + 60_000)), max: instantToLocal(new Date(now + MAX_PAUSE_MS)) };
}

export function BotOffMenu({
  conversationId,
  paused,
  onChanged,
  align = "end",
}: {
  conversationId: string;
  paused: boolean;
  onChanged: () => void;
  align?: "start" | "end";
}) {
  const [picking, setPicking] = useState(false);
  const [at, setAt] = useState(defaultAt);
  const [limits, setLimits] = useState({ min: "", max: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Candado síncrono contra el doble clic (el estado `busy` llega un render tarde).
  const inFlight = useRef(false);

  async function apply(option: PauseOption, atLocal?: string) {
    if (inFlight.current) return;
    // Misma validación que el servidor (que la repite con su reloj).
    const check = pauseUntil(option, new Date(), atLocal);
    if (!check.ok) return setError(check.message);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await pauseAgent({ conversationId, option, atLocal: atLocal ?? null });
      if (!result.ok) return setError(result.message);
      setPicking(false);
      onChanged();
    } catch {
      setError("No se pudo pausar el agente. Intenta de nuevo.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function choose(option: PauseOption) {
    setError(null);
    if (option !== "exacta") return void apply(option);
    setLimits(pickerLimits());
    setAt(defaultAt());
    setPicking(true);
  }

  return (
    <div className="relative shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy}
          title={paused ? "Cambiar hasta cuándo está pausado el agente en este chat" : "Pausar el agente solo en este chat"}
          className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {busy ? "Guardando…" : paused ? "Cambiar hora" : "Pausar agente"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{paused ? "Pausado hasta…" : "Pausar el agente en este chat"}</DropdownMenuLabel>
            {PAUSE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option} onClick={() => choose(option)}>
                {PAUSE_OPTION_LABELS[option]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {(picking || error) && (
        <div
          className={`absolute top-full z-30 mt-1 w-72 rounded-lg border bg-background p-3 text-xs shadow-md ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{picking ? "🤖 Pausar el agente hasta…" : "🤖 Pausar agente"}</span>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setError(null);
              }}
              aria-label="Cerrar"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {picking && (
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-muted-foreground">Fecha y hora (Mazatlán)</span>
                <DateTimePicker mode="datetime" value={at} min={limits.min} max={limits.max} onChange={setAt} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
              </label>
              <button
                type="button"
                onClick={() => void apply("exacta", at)}
                disabled={busy || !at}
                className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
              >
                Pausar
              </button>
            </div>
          )}
          {error && <p className={`${picking ? "mt-2" : ""} text-brand-orange`}>{error}</p>}
        </div>
      )}
    </div>
  );
}
