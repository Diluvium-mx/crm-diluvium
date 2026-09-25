"use client";

// Qué modelo atiende cada etapa del Embudo (Fase E): una fila por etapa con "1 | 2".
// Guarda al tocar (sin confirmación: se regresa con otro toque). Un cambio a la vez:
// mientras guarda, los botones esperan; si falla (o se cae la red), regresa a lo
// que había. Sin lógica de datos: guarda con la Server Action.
import { useState, useTransition } from "react";
import { STAGE_LABELS, STAGES, type Stage } from "@/app/(app)/contactos/_data/types";
import { updateModel1Stages } from "@/lib/actions/agente-ia-editor";

export function StageModelAssignment({ value, model1Label, model2Label }: { value: string[]; model1Label: string; model2Label: string }) {
  const [stages, setStages] = useState<string[]>(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function assign(stage: Stage, slot: 1 | 2) {
    if (pending) return;
    const next = slot === 1 ? [...stages.filter((s) => s !== stage), stage] : stages.filter((s) => s !== stage);
    const previous = stages;
    setStages(next);
    setError(null);
    start(async () => {
      try {
        const r = await updateModel1Stages({ stages: next });
        if (!r.ok) {
          setStages(previous);
          setError(r.message);
        }
      } catch {
        setStages(previous);
        setError("No se pudo guardar; revisa tu conexión e inténtalo de nuevo.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-black/5 rounded-md border border-black/10 dark:divide-white/5 dark:border-white/10" aria-busy={pending || undefined}>
        {STAGES.map((stage) => {
          const slot = stages.includes(stage) ? 1 : 2;
          return (
            <li key={stage} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm text-foreground">{STAGE_LABELS[stage]}</span>
              <div role="radiogroup" aria-label={`Modelo para ${STAGE_LABELS[stage]}`} className="flex overflow-hidden rounded border border-black/15 text-xs dark:border-white/15">
                {([1, 2] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={slot === n}
                    disabled={pending}
                    onClick={() => slot !== n && assign(stage, n)}
                    aria-label={`Modelo ${n} (${n === 1 ? model1Label : model2Label})`}
                    className={`px-3 py-1 transition-colors disabled:cursor-wait ${
                      slot === n ? "bg-brand-navy text-white" : "bg-background text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    Modelo {n}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
    </div>
  );
}
