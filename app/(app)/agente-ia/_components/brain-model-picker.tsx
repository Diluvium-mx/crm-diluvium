"use client";

// Selector de modelo (sección "Crear"): cada opción con su costo aproximado por
// cada 100 conversaciones y las etiquetas "Recomendado" y "Nuevo"; en gris si falta
// su llave o su adaptador, diciendo por qué. Elegir otra opción pide confirmación
// arriba (use-model-change.tsx) y solo entonces guarda. ModelPicker sirve para
// cualquier modelo del agente (la parte (c) de Fase D lo divide en Modelo 1 y
// Modelo 2); BrainModelPicker es el del cerebro. Sin lógica de datos.
import { updateBrainModel } from "@/lib/actions/agente-ia-editor";
import { costPer100Label } from "@/lib/agente-ia/model-cost";
import type { AgentActionResult, ModelOptionView } from "@/lib/agente-ia/types";
import { useModelChange } from "./use-model-change";

function Badge({ children, tone }: { children: React.ReactNode; tone: "navy" | "orange" }) {
  const cls = tone === "navy" ? "bg-brand-navy/10 text-brand-navy dark:text-sky-300" : "bg-brand-orange/15 text-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function ModelPicker({
  options,
  value,
  agentName,
  target,
  ariaLabel,
  save,
}: {
  options: ModelOptionView[];
  value: string;
  agentName: string;
  // "el cerebro", "el Modelo 1"…: va en la pregunta de confirmación.
  target: string;
  ariaLabel: string;
  save: (modelId: string) => Promise<AgentActionResult>;
}) {
  const change = useModelChange({ agentName, target, options, value, save });

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={ariaLabel} className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const active = o.id === change.selected;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              // Mientras guarda no se deshabilitan (request() ignora el clic): así el
              // foco puede regresar a la opción al cerrarse el pop-up.
              disabled={!o.available}
              aria-busy={change.pending && active ? true : undefined}
              onClick={() => change.request(o)}
              className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent ${
                active ? "border-brand-navy bg-brand-navy/5" : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              }`}
            >
              {/* En gris lo que no se puede elegir; el porqué queda legible abajo. */}
              <span className={`flex w-full flex-wrap items-center gap-1.5 ${o.available ? "" : "opacity-50"}`}>
                <span className="text-sm font-medium text-foreground">{o.label}</span>
                {o.recommended && <Badge tone="navy">Recomendado</Badge>}
                {o.isNew && <Badge tone="orange">Nuevo</Badge>}
              </span>
              <span className={`text-xs text-muted-foreground ${o.available ? "" : "opacity-50"}`}>
                {o.providerLabel} · <span title="aproximado, sin impuestos">{costPer100Label(o.costPer100Usd)}</span>
              </span>
              {!o.available && <span className="text-xs text-foreground/80">{o.disabledReason ?? "No disponible"}</span>}
            </button>
          );
        })}
      </div>
      {change.error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{change.error}</p>}
      {change.ui}
    </div>
  );
}

async function saveBrain(modelId: string): Promise<AgentActionResult> {
  return updateBrainModel({ modelId });
}

export function BrainModelPicker({ options, value, agentName }: { options: ModelOptionView[]; value: string; agentName: string }) {
  return (
    <ModelPicker options={options} value={value} agentName={agentName} target="el cerebro" ariaLabel="Modelo del agente" save={saveBrain} />
  );
}
