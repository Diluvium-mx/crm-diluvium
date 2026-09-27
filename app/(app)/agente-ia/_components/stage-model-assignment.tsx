"use client";

// Qué modelo atiende cada etapa del Embudo (Fase E): una fila por etapa con "1 | 2".
// Al tocar el otro modelo NO se guarda: pide confirmación arriba («¿Cambiar la etapa
// Interesado al Modelo 2 (Claude Sonnet 5)?») y guarda SOLO con «Sí, cambiar» (regla
// del dueño, 27-sep-2026; use-confirm.tsx). Un cambio a la vez; si falla, se queda lo
// que había y se dice por qué. Sin lógica de datos: guarda con la Server Action.
import { useState } from "react";
import { STAGE_LABELS, STAGES, type Stage } from "@/app/(app)/contactos/_data/types";
import { updateModel1Stages } from "@/lib/actions/agente-ia-editor";
import { useConfirm } from "./use-confirm";

export function StageModelAssignment({ value, model1Label, model2Label }: { value: string[]; model1Label: string; model2Label: string }) {
  const [stages, setStages] = useState<string[]>(value);
  const confirm = useConfirm();

  function assign(stage: Stage, slot: 1 | 2) {
    const next = slot === 1 ? [...stages.filter((s) => s !== stage), stage] : stages.filter((s) => s !== stage);
    const label = STAGE_LABELS[stage];
    const to = slot === 1 ? model1Label : model2Label;
    const from = slot === 1 ? model2Label : model1Label;
    confirm.ask({
      title: `¿Cambiar la etapa ${label} al Modelo ${slot} (${to})?`,
      body:
        to === from
          ? `Desde el siguiente mensaje, los contactos en ${label} los contestará el Modelo ${slot} (hoy los dos modelos son ${to}).`
          : `Desde el siguiente mensaje, los contactos en ${label} los contestará ${to} en lugar de ${from}.`,
      confirmLabel: "Sí, cambiar",
      pendingLabel: "Cambiando…",
      done: `Listo: ${label} ahora la atiende el Modelo ${slot} (${to})`,
      run: () => updateModel1Stages({ stages: next }),
      onDone: () => setStages(next),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-black/5 rounded-md border border-black/10 dark:divide-white/5 dark:border-white/10" aria-busy={confirm.pending || undefined}>
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
                    // Mientras guarda no se deshabilitan (ask() ignora el clic): así el
                    // foco puede regresar al botón al cerrarse el pop-up.
                    onClick={() => slot !== n && assign(stage, n)}
                    aria-label={`Modelo ${n} (${n === 1 ? model1Label : model2Label})`}
                    className={`px-3 py-1 transition-colors ${
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
      {confirm.error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.error}</p>}
      {confirm.ui}
    </div>
  );
}
