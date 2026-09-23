"use client";

// Pestaña "Automatización" (Fase D): lista de workflows (habilitar, ordenar,
// editar, probar), biblioteca de media y corridas recientes. Solo owner/admin.
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  deleteWorkflow,
  listConversationsForTest,
  listWorkflowRuns,
  listWorkflows,
  reorderWorkflows,
  restoreDefaultWorkflows,
  runWorkflowTest,
  saveWorkflow,
  toggleWorkflow,
  type WorkflowRunView,
  type WorkflowView,
} from "@/lib/actions/workflows";
import type { MediaAssetView } from "@/lib/media-library/service";
import { STAGE_LABELS } from "../../contactos/_data/types";
import { BibliotecaTab } from "./biblioteca-tab";
import { RUN_STATUS_LABEL, SKIP_REASON_LABEL, STEP_ICON, stepSummary, TRIGGER_LABEL } from "./labels";
import { toDraft, toInput, WorkflowEditor, type EditorDraft } from "./workflow-editor";

type Tab = "workflows" | "biblioteca" | "corridas";

export function AutomatizacionPanel({
  initialWorkflows,
  initialAssets,
  initialRuns,
}: {
  initialWorkflows: WorkflowView[];
  initialAssets: MediaAssetView[];
  initialRuns: WorkflowRunView[];
}) {
  const [tab, setTab] = useState<Tab>("workflows");
  const [items, setItems] = useState(initialWorkflows);
  const [assets, setAssets] = useState(initialAssets);
  const [runs, setRuns] = useState(initialRuns);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [testing, setTesting] = useState<WorkflowView | null>(null);

  async function reload() {
    setItems(await listWorkflows());
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setNotice(null);
    const r = await saveWorkflow(toInput(draft));
    setBusy(false);
    if (!r.ok) return setNotice({ kind: "error", text: r.error });
    await reload();
    setDraft(null);
    setNotice({ kind: "ok", text: "Workflow guardado." });
  }

  async function toggle(w: WorkflowView) {
    setNotice(null);
    const r = await toggleWorkflow({ id: w.id, enabled: !w.enabled });
    if (!r.ok) return setNotice({ kind: "error", text: r.error });
    setItems((cur) => cur.map((x) => (x.id === w.id ? { ...x, enabled: !w.enabled } : x)));
  }

  async function remove(w: WorkflowView) {
    if (!window.confirm(`¿Borrar el workflow "${w.name}"?`)) return;
    const r = await deleteWorkflow({ id: w.id });
    if (!r.ok) return setNotice({ kind: "error", text: r.error });
    setItems((cur) => cur.filter((x) => x.id !== w.id));
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    const r = await reorderWorkflows({ ids: next.map((w) => w.id) });
    if (!r.ok) setNotice({ kind: "error", text: r.error });
  }

  async function restore() {
    const r = await restoreDefaultWorkflows();
    if (!r.ok) return setNotice({ kind: "error", text: r.error });
    await reload();
    setNotice({ kind: "ok", text: r.created ? `${r.created} predeterminado(s) restaurados (apagados).` : "No faltaba ningún predeterminado." });
  }

  const tabButton = (t: Tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t ? "bg-brand-orange text-brand-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="text-sm font-semibold">Automatización</h1>
        <div role="tablist" aria-label="Secciones" className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
          {tabButton("workflows", "⚙️ Workflows")}
          {tabButton("biblioteca", "🗂 Biblioteca")}
          {tabButton("corridas", "📋 Corridas")}
        </div>
      </header>

      {notice && (
        <div className={`mx-4 mt-3 rounded-md border px-3 py-2 text-sm ${notice.kind === "ok" ? "border-green-300 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300" : "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"}`}>
          {notice.text}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "biblioteca" && <BibliotecaTab assets={assets} onChanged={setAssets} />}
        {tab === "corridas" && <CorridasTab runs={runs} onRefresh={async () => setRuns(await listWorkflowRuns())} />}
        {tab === "workflows" && (
          <div className="mx-auto max-w-4xl space-y-4 p-4">
            {draft ? (
              <div className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{draft.id ? "Editar workflow" : "Nuevo workflow"}</h2>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Habilitado
                  </label>
                </div>
                <WorkflowEditor draft={draft} onChange={setDraft} assets={assets} onAssetsChanged={setAssets} isSystem={items.find((w) => w.id === draft.id)?.isSystem ?? false} />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setDraft(null)} disabled={busy} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
                    Cancelar
                  </button>
                  <button type="button" onClick={() => void save()} disabled={busy} className="rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-60">
                    {busy ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Secuencias de pasos que dispara el Agente IA, un comando del vendedor (<code className="text-brand-orange">/tabla</code>), una palabra clave del cliente o un cambio de etapa.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void restore()} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted" title="Vuelve a crear los predeterminados que falten">
                      <RotateCcw className="size-4" aria-hidden="true" /> Restaurar predeterminados
                    </button>
                    <button type="button" onClick={() => setDraft(toDraft(null))} className="flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light">
                      <Plus className="size-4" aria-hidden="true" /> Nuevo
                    </button>
                  </div>
                </div>
                {items.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hay workflows. Restaura los predeterminados o crea uno.</p>}
                <ul className="space-y-2">
                  {items.map((w, i) => (
                    <li key={w.id} className={`rounded-lg border bg-card p-3 shadow-sm ${w.missingMedia.length ? "border-brand-orange/60" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2" title={w.enabled ? "Habilitado" : "Deshabilitado"}>
                          <input type="checkbox" checked={w.enabled} onChange={() => void toggle(w)} aria-label={`Habilitar ${w.name}`} />
                        </label>
                        <span className="text-sm font-semibold">{w.name}</span>
                        {w.triggerAgent && <Chip>🤖 agente</Chip>}
                        {w.triggerCommand && <Chip mono>{w.triggerCommand}</Chip>}
                        {w.triggerKeywords.length > 0 && <Chip>🔑 {w.triggerKeywords.slice(0, 3).join(", ")}{w.triggerKeywords.length > 3 ? "…" : ""}</Chip>}
                        {w.triggerStage && <Chip>↗ {STAGE_LABELS[w.triggerStage]}</Chip>}
                        {w.missingMedia.length > 0 && <Chip warn>⚠ falta archivo</Chip>}
                        <span className="ml-auto text-[11px] text-muted-foreground">{w.runs7d} corridas · 7 días</span>
                        <div className="flex gap-0.5">
                          <IconBtn label="Subir" onClick={() => void move(i, -1)} disabled={i === 0}>
                            <ArrowUp className="size-4" />
                          </IconBtn>
                          <IconBtn label="Bajar" onClick={() => void move(i, 1)} disabled={i === items.length - 1}>
                            <ArrowDown className="size-4" />
                          </IconBtn>
                          <IconBtn label="Probar" onClick={() => setTesting(w)} disabled={!w.enabled}>
                            <Play className="size-4" />
                          </IconBtn>
                          <IconBtn label="Editar" onClick={() => setDraft(toDraft(w))}>
                            <Pencil className="size-4" />
                          </IconBtn>
                          {!w.isSystem && (
                            <IconBtn label="Borrar" onClick={() => void remove(w)} danger>
                              <Trash2 className="size-4" />
                            </IconBtn>
                          )}
                        </div>
                      </div>
                      <ol className="mt-2 flex flex-wrap gap-1.5">
                        {w.steps.map((s, j) => (
                          <li key={j} className="max-w-xs truncate rounded bg-muted px-2 py-0.5 text-[11px]" title={stepSummary(s)}>
                            {STEP_ICON[s.kind]} {stepSummary(s)}
                          </li>
                        ))}
                        {w.steps.length === 0 && <li className="text-[11px] text-muted-foreground">sin pasos</li>}
                      </ol>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {testing && (
        <TestDialog
          workflow={testing}
          onClose={() => setTesting(null)}
          onDone={(text) => {
            setNotice({ kind: "ok", text });
            setTesting(null);
            void listWorkflowRuns().then(setRuns);
          }}
        />
      )}
    </div>
  );
}

function Chip({ children, mono, warn }: { children: React.ReactNode; mono?: boolean; warn?: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] ${warn ? "bg-brand-orange/15 font-medium text-brand-orange" : mono ? "bg-brand-navy font-mono text-brand-white" : "bg-muted text-muted-foreground"}`}>
      {children}
    </span>
  );
}

function IconBtn({ children, label, onClick, disabled, danger }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={`rounded p-1 text-muted-foreground disabled:opacity-30 ${danger ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-muted hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function TestDialog({ workflow, onClose, onDone }: { workflow: WorkflowView; onClose: () => void; onDone: (text: string) => void }) {
  const [options, setOptions] = useState<{ id: string; label: string }[] | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (options === null) {
    void listConversationsForTest().then((list) => {
      setOptions(list);
      if (list[0]) setConversationId(list[0].id);
    });
  }
  async function run() {
    setBusy(true);
    setError(null);
    const r = await runWorkflowTest({ workflowId: workflow.id, conversationId });
    setBusy(false);
    if (!r.ok) return setError("error" in r ? r.error : "No es un comando.");
    onDone(r.status === "queued" ? `"${r.name}" en marcha: revisa el hilo de esa conversación.` : `"${r.name}" no se ejecutó: ${SKIP_REASON_LABEL[r.reason ?? ""] ?? r.reason}.`);
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Probar workflow" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">Probar “{workflow.name}”</h3>
        <p className="text-xs text-muted-foreground">Se ejecuta como comando del vendedor en la conversación elegida (manda mensajes reales por WhatsApp).</p>
        <select value={conversationId} onChange={(e) => setConversationId(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
          {(options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Cancelar
          </button>
          <button type="button" onClick={() => void run()} disabled={busy || !conversationId} className="rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-60">
            {busy ? "Enviando…" : "Ejecutar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CorridasTab({ runs, onRefresh }: { runs: WorkflowRunView[]; onRefresh: () => Promise<void> }) {
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Últimas 100 corridas. Un “omitido” trae su motivo; un “falló” su código.</p>
        <button type="button" onClick={() => void onRefresh()} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
          Actualizar
        </button>
      </div>
      {runs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Sin corridas todavía.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Cuándo</th>
              <th className="py-1 pr-2">Workflow</th>
              <th className="py-1 pr-2">Contacto</th>
              <th className="py-1 pr-2">Disparador</th>
              <th className="py-1 pr-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1.5 pr-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("es-MX", { timeZone: "America/Mazatlan", dateStyle: "short", timeStyle: "short" })}</td>
                <td className="py-1.5 pr-2">{r.workflowName}</td>
                <td className="py-1.5 pr-2">{r.contactName}</td>
                <td className="py-1.5 pr-2 text-xs">{TRIGGER_LABEL[r.trigger]}</td>
                <td className="py-1.5 pr-2 text-xs">
                  <span className={r.status === "done" ? "text-green-700" : r.status === "failed" ? "text-red-600" : r.status === "skipped" || r.status === "cancelled" ? "text-brand-orange" : ""}>
                    {RUN_STATUS_LABEL[r.status]}
                  </span>
                  {r.errorCode && <span className="ml-1 text-muted-foreground">· {SKIP_REASON_LABEL[r.errorCode] ?? r.errorCode}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
