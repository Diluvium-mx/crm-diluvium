"use client";

import { useState, useTransition } from "react";
import { probarModelo, updateAiConfig } from "@/lib/actions/ai-config";
import { AgenteSettings } from "./agente-settings";
import type {
  AgentSettingsBundleView,
  AiConfigView,
  DryRunStageView,
  ModelOptionView,
  ProbarModeloResultView,
} from "@/lib/agente-ia/types";

const TIER_LABEL: Record<string, string> = {
  tope: "Tope",
  balanceado: "Balanceado",
  economico: "Económico",
};

function optionLabel(o: ModelOptionView): string {
  const parts = [
    o.label,
    `· ${TIER_LABEL[o.tier] ?? o.tier}`,
    o.multimodal ? "· multimodal" : "· solo texto",
  ];
  if (!o.available && o.disabledReason) parts.push(`· ${o.disabledReason}`);
  return parts.join(" ");
}

function tokenLine(usage: DryRunStageView["usage"]): string {
  const n = (v: number | null) => (v === null ? "—" : String(v));
  if (!usage) return "";
  return `entrada ${n(usage.inputTokens)} · salida ${n(usage.outputTokens)} · caché lectura ${n(
    usage.cacheReadTokens,
  )} · caché escritura ${n(usage.cacheWriteTokens)}`;
}

function ModelSelect({
  id,
  title,
  hint,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  hint: string;
  value: string;
  options: ModelOptionView[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs text-foreground/70">{hint}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded border border-black/15 bg-background px-3 py-2 text-sm disabled:opacity-60 dark:border-white/15"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={!o.available}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function StageCard({ stage }: { stage: DryRunStageView }) {
  const title = stage.stage === "filtro" ? "Filtro" : "Cerebro";
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-foreground/70">
          {stage.label} · <code className="font-mono">{stage.modelId}</code>
        </span>
      </div>
      {stage.ok ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{stage.text}</p>
          <p className="mt-2 text-xs text-foreground/70">{tokenLine(stage.usage)}</p>
        </>
      ) : (
        <p className="mt-2 border-l-2 border-brand-orange pl-2 text-sm text-foreground">{stage.error}</p>
      )}
    </div>
  );
}

export function AgenteIaPanel({
  config,
  filterOptions,
  brainOptions,
  bundle,
}: {
  config: AiConfigView;
  filterOptions: ModelOptionView[];
  brainOptions: ModelOptionView[];
  bundle: AgentSettingsBundleView;
}) {
  const [filtro, setFiltro] = useState(config.modeloFiltro);
  const [cerebro, setCerebro] = useState(config.modeloCerebro);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  function save(next: { modeloFiltro: string; modeloCerebro: string }, revert: () => void) {
    setSaveError(null);
    startSaving(async () => {
      try {
        await updateAiConfig(next);
        setSavedAt(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }));
      } catch (error) {
        revert();
        setSaveError(error instanceof Error ? error.message : "No se pudo guardar la configuración.");
      }
    });
  }

  function changeFiltro(next: string) {
    const previous = filtro;
    setFiltro(next);
    save({ modeloFiltro: next, modeloCerebro: cerebro }, () => setFiltro(previous));
  }

  function changeCerebro(next: string) {
    const previous = cerebro;
    setCerebro(next);
    save({ modeloFiltro: filtro, modeloCerebro: next }, () => setCerebro(previous));
  }

  const [isTesting, startTesting] = useTransition();
  const [result, setResult] = useState<ProbarModeloResultView | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  function probar() {
    setTestError(null);
    setResult(null);
    startTesting(async () => {
      try {
        setResult(await probarModelo());
      } catch (error) {
        setTestError(error instanceof Error ? error.message : "No se pudo ejecutar la prueba.");
      }
    });
  }

  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">Agente IA</h1>
          <p className="text-sm text-foreground/70">
            Angela responde por WhatsApp con el Goal y las preguntas frecuentes. El filtro decide si
            un mensaje necesita respuesta; el cerebro la redacta. Enciéndelo por canal abajo.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <ModelSelect
            id="modelo-filtro"
            title="Modelo del filtro"
            hint="Clasifica la bandeja (rápido y económico)."
            value={filtro}
            options={filterOptions}
            disabled={isSaving}
            onChange={changeFiltro}
          />
          <ModelSelect
            id="modelo-cerebro"
            title="Modelo del cerebro"
            hint="Redacta y razona las respuestas del agente."
            value={cerebro}
            options={brainOptions}
            disabled={isSaving}
            onChange={changeCerebro}
          />
          <div className="min-h-5 text-xs">
            {isSaving && <span className="text-foreground/70">Guardando…</span>}
            {!isSaving && saveError && <span className="border-l-2 border-brand-orange pl-2 text-foreground">{saveError}</span>}
            {!isSaving && !saveError && savedAt && (
              <span className="text-foreground/70">Guardado a las {savedAt}</span>
            )}
          </div>
          <p className="text-xs text-foreground/70">
            Una opción en gris no tiene su llave (API key) configurada en el entorno, o su proveedor
            aún no está disponible. Agrega la llave en Railway (servicio web) para habilitarla.
          </p>
        </section>

        <AgenteSettings bundle={bundle} />

        <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <h2 className="text-sm font-semibold text-foreground">Probar modelo</h2>
              <p className="text-xs text-foreground/70">
                Manda un mensaje de ejemplo por filtro → cerebro con la config actual. No toca
                WhatsApp ni conversaciones reales.
              </p>
            </div>
            <button
              type="button"
              onClick={probar}
              disabled={isTesting}
              className="shrink-0 rounded bg-brand-orange px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange-light disabled:opacity-60"
            >
              {isTesting ? "Probando…" : "Probar modelo"}
            </button>
          </div>

          {testError && <p className="border-l-2 border-brand-orange pl-2 text-sm text-foreground">{testError}</p>}

          {result && (
            <div className="flex flex-col gap-3">
              {result.stages.map((stage) => (
                <StageCard key={stage.stage} stage={stage} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
