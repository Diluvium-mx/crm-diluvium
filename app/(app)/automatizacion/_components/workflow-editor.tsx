"use client";

// Editor de UN workflow (Fase D, §4 del diseño): datos generales, disparadores
// y la lista ordenada de pasos como tarjetas. El paso "Archivo" elige de la
// biblioteca (o sube ahí mismo). Sin lienzo visual: eso es v2.
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { STAGES, STAGE_LABELS } from "../../contactos/_data/types";
import type { WorkflowInput, WorkflowView } from "@/lib/actions/workflows";
import type { MediaAssetView } from "@/lib/media-library/service";
import { MAX_STEPS, MAX_WAIT_SECONDS, type StepPayload } from "@/lib/workflows/steps";
import { AssetPreview, uploadAsset } from "./biblioteca-tab";
import { STEP_ICON, STEP_LABEL } from "./labels";

export type EditorDraft = Omit<WorkflowInput, "triggerKeywords"> & { keywordsText: string };

export function toDraft(w: WorkflowView | null): EditorDraft {
  return {
    id: w?.id ?? null,
    name: w?.name ?? "",
    agentDescription: w?.agentDescription ?? "",
    enabled: w?.enabled ?? false,
    triggerAgent: w?.triggerAgent ?? true,
    keywordsText: (w?.triggerKeywords ?? []).join(", "),
    triggerCommand: w?.triggerCommand ?? null,
    triggerStage: w?.triggerStage ?? null,
    steps: w?.steps ?? [],
  };
}

export function toInput(d: EditorDraft): WorkflowInput {
  return {
    id: d.id,
    name: d.name,
    agentDescription: d.agentDescription,
    enabled: d.enabled,
    triggerAgent: d.triggerAgent,
    triggerKeywords: d.keywordsText
      .split(/[,\n]/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
    triggerCommand: d.triggerCommand?.trim() ? d.triggerCommand.trim().toLowerCase() : null,
    triggerStage: d.triggerStage,
    steps: d.steps,
  };
}

const NEW_STEP: Record<StepPayload["kind"], () => StepPayload> = {
  send_text: () => ({ kind: "send_text", text: "" }),
  send_media: () => ({ kind: "send_media", assetId: null, title: "Archivo" }),
  wait: () => ({ kind: "wait", seconds: 2 }),
};

const inputClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/30";

export function WorkflowEditor({
  draft,
  onChange,
  assets,
  onAssetsChanged,
  isSystem,
}: {
  draft: EditorDraft;
  onChange: (next: EditorDraft) => void;
  assets: MediaAssetView[];
  onAssetsChanged: (next: MediaAssetView[]) => void;
  isSystem: boolean;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const set = (patch: Partial<EditorDraft>) => onChange({ ...draft, ...patch });
  const setStep = (i: number, step: StepPayload) => set({ steps: draft.steps.map((s, j) => (j === i ? step : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[i], next[j]] = [next[j], next[i]];
    set({ steps: next });
  };

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Nombre</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} className={inputClass} placeholder="p. ej. Tabla de tamaños" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Cuándo usarlo (lo lee el Agente IA para decidir si lo dispara)</span>
          <textarea
            value={draft.agentDescription}
            onChange={(e) => set({ agentDescription: e.target.value })}
            rows={3}
            maxLength={1000}
            className={inputClass}
            placeholder="Úsalo cuando el cliente pregunte… Responde primero su duda en texto y luego llama esta herramienta."
          />
        </label>
      </section>

      <section className="space-y-2 rounded-lg border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Disparadores</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.triggerAgent} onChange={(e) => set({ triggerAgent: e.target.checked })} />
            El Agente IA puede dispararlo
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Comando del vendedor (en el chat)</span>
            <input value={draft.triggerCommand ?? ""} onChange={(e) => set({ triggerCommand: e.target.value || null })} className={inputClass} placeholder="/tabla" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Al entrar a la etapa</span>
            <select value={draft.triggerStage ?? ""} onChange={(e) => set({ triggerStage: (e.target.value || null) as EditorDraft["triggerStage"] })} className={inputClass}>
              <option value="">— no —</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Palabras clave del cliente (separadas por coma; palabra completa, sin importar acentos)</span>
            <input value={draft.keywordsText} onChange={(e) => set({ keywordsText: e.target.value })} className={inputClass} placeholder="tabla, tamaños" />
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pasos (en orden)</h3>
          <span className="text-[11px] text-muted-foreground">
            Variables: {"{{nombre}}"} {"{{vendedor}}"} · {draft.steps.length}/{MAX_STEPS}
          </span>
        </div>
        {draft.steps.length === 0 && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Sin pasos. Agrega uno abajo.</p>}
        <ol className="space-y-2">
          {draft.steps.map((step, i) => (
            <li key={i} className="rounded-lg border bg-card p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold">
                  {i + 1}. {STEP_ICON[step.kind]} {STEP_LABEL[step.kind]}
                </span>
                <div className="ml-auto flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label="Subir">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label="Bajar">
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label="Quitar paso">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <StepFields step={step} onChange={(s) => setStep(i, s)} assets={assets} onPick={() => setPicking(i)} />
            </li>
          ))}
        </ol>
        {draft.steps.length < MAX_STEPS && (
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(STEP_LABEL) as StepPayload["kind"][]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => set({ steps: [...draft.steps, NEW_STEP[kind]()] })}
                className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:border-brand-orange hover:text-brand-orange"
              >
                <Plus className="size-3" aria-hidden="true" /> {STEP_ICON[kind]} {STEP_LABEL[kind]}
              </button>
            ))}
          </div>
        )}
      </section>

      {isSystem && <p className="text-[11px] text-muted-foreground">Predeterminado del CRM: se puede editar y deshabilitar, pero no borrar.</p>}

      {picking !== null && (
        <MediaPicker
          assets={assets}
          onAssetsChanged={onAssetsChanged}
          onClose={() => setPicking(null)}
          onPick={(asset) => {
            const step = draft.steps[picking];
            if (step?.kind === "send_media") setStep(picking, { ...step, assetId: asset.id, title: asset.title });
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function StepFields({
  step,
  onChange,
  assets,
  onPick,
}: {
  step: StepPayload;
  onChange: (s: StepPayload) => void;
  assets: MediaAssetView[];
  onPick: () => void;
}) {
  switch (step.kind) {
    case "send_text":
      return (
        <textarea
          value={step.text}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
          rows={3}
          className={inputClass}
          placeholder="Texto que recibe el cliente…"
        />
      );
    case "send_media": {
      const asset = step.assetId ? assets.find((a) => a.id === step.assetId) : null;
      return (
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-3">
            {asset ? <AssetPreview asset={asset} className="h-16 w-24 rounded" /> : <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed text-xs text-brand-orange">⚠ falta</div>}
            <div className="space-y-1">
              <p className="text-sm font-medium">{asset ? asset.title : step.title}</p>
              <button type="button" onClick={onPick} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:border-brand-orange hover:text-brand-orange">
                {asset ? "Cambiar archivo" : "Elegir de la biblioteca"}
              </button>
            </div>
          </div>
          <label className="min-w-[14rem] flex-1 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Texto del archivo (va como pie del adjunto, en el mismo mensaje; opcional)</span>
            <textarea
              value={step.caption ?? ""}
              onChange={(e) => onChange({ ...step, caption: e.target.value || undefined })}
              rows={3}
              maxLength={1024}
              className={inputClass}
              placeholder="Texto que acompaña a la imagen o video…"
            />
          </label>
        </div>
      );
    }
    case "wait":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="number" min={1} max={MAX_WAIT_SECONDS} value={step.seconds} onChange={(e) => onChange({ ...step, seconds: Math.max(1, Math.min(MAX_WAIT_SECONDS, Number(e.target.value) || 1)) })} className="w-20 rounded-md border bg-background px-2 py-1" />
          segundos antes del siguiente paso
        </label>
      );
  }
}

function MediaPicker({
  assets,
  onAssetsChanged,
  onPick,
  onClose,
}: {
  assets: MediaAssetView[];
  onAssetsChanged: (next: MediaAssetView[]) => void;
  onPick: (asset: MediaAssetView) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const r = await uploadAsset(file, "");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onAssetsChanged([r.asset, ...assets]);
    onPick(r.asset);
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Elegir archivo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Biblioteca de media</h3>
          <label className="cursor-pointer rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-brand-white hover:bg-brand-orange-light">
            {busy ? "Subiendo…" : "Subir nuevo"}
            <input type="file" accept="image/png,image/jpeg,video/mp4,video/3gpp,application/pdf" className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {assets.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">La biblioteca está vacía. Sube el archivo.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {assets.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onPick(a)} className="w-full overflow-hidden rounded-lg border text-left hover:border-brand-orange">
                  <AssetPreview asset={a} className="h-28 w-full" />
                  <span className="block truncate px-2 py-1 text-xs font-medium">{a.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
