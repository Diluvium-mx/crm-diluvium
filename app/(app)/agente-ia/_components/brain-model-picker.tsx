"use client";

// Selector del modelo CEREBRO (sección "Crear"): cada opción con su indicador de
// costo ($ a $$$$) y las etiquetas "Recomendado" y "Nuevo"; en gris si falta su
// llave o su adaptador. Sin lógica de datos: solo llama a updateBrainModel.
import { useState, useTransition } from "react";
import { updateBrainModel } from "@/lib/actions/agente-ia-editor";
import type { ModelOptionView } from "@/lib/agente-ia/types";

function Badge({ children, tone }: { children: React.ReactNode; tone: "navy" | "orange" | "muted" }) {
  const cls =
    tone === "navy"
      ? "bg-brand-navy/10 text-brand-navy dark:text-sky-300"
      : tone === "orange"
        ? "bg-brand-orange/15 text-foreground"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function Cost({ tier }: { tier: ModelOptionView["costTier"] }) {
  if (tier === null) return <span className="text-xs text-muted-foreground">costo sin dato</span>;
  return (
    <span className="text-xs font-semibold tracking-wide" aria-label={`Costo ${tier} de 4`} title="Costo relativo por respuesta">
      <span className="text-foreground">{"$".repeat(tier)}</span>
      <span className="text-muted-foreground/40">{"$".repeat(4 - tier)}</span>
    </span>
  );
}

export function BrainModelPicker({ options, value }: { options: ModelOptionView[]; value: string }) {
  const [selected, setSelected] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(o: ModelOptionView) {
    if (!o.available || o.id === selected) return;
    const previous = selected;
    setSelected(o.id);
    setError(null);
    start(async () => {
      const r = await updateBrainModel({ modelId: o.id });
      if (!r.ok) {
        setSelected(previous);
        setError(r.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Modelo del agente" className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const active = o.id === selected;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!o.available || pending}
              onClick={() => choose(o)}
              title={o.disabledReason ?? undefined}
              className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                active ? "border-brand-navy bg-brand-navy/5" : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              } ${o.available ? "" : "opacity-45"}`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{o.label}</span>
                <Cost tier={o.costTier} />
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{o.providerLabel}</span>
                {o.recommended && <Badge tone="navy">Recomendado</Badge>}
                {o.isNew && <Badge tone="orange">Nuevo</Badge>}
                {!o.available && <Badge tone="muted">{o.disabledReason ?? "No disponible"}</Badge>}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
    </div>
  );
}
