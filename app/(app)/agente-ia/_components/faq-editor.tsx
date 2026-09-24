"use client";

// Base de conocimiento del agente (sección "Crear"): las preguntas frecuentes para
// agregar, editar, activar/desactivar o borrar. Cada cambio deja una versión de
// todas las FAQs (se puede regresar a una anterior). Sin lógica de datos.
import { useState } from "react";
import { createAgentFaq, deleteAgentFaq, restoreAgentFaqs, updateAgentFaq } from "@/lib/actions/agente-ia-editor";
import type { AgentActionResult, FaqView, VersionView } from "@/lib/agente-ia/types";
import { VersionsList } from "./versions-list";

const input =
  "w-full rounded border border-black/15 bg-background px-2 py-1.5 text-sm text-foreground dark:border-white/15";

function FaqForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { question: string; answer: string; enabled: boolean };
  submitLabel: string;
  onSubmit: (v: { question: string; answer: string; enabled: boolean }) => Promise<AgentActionResult>;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await onSubmit({ question, answer, enabled });
    setBusy(false);
    if (r.ok) onCancel();
    else setError(r.message);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-brand-navy/30 bg-brand-navy/5 p-3">
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pregunta" aria-label="Pregunta" className={input} />
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Respuesta" aria-label="Respuesta" rows={4} className={`${input} resize-y`} />
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--brand-navy)]" />
        Activa (el agente la usa)
      </label>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void submit()} className="rounded bg-brand-orange px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy ? "Guardando…" : submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="text-xs text-muted-foreground hover:underline">
          Cancelar
        </button>
        {error && <span className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</span>}
      </div>
    </div>
  );
}

export function FaqEditor({ faqs, versions }: { faqs: FaqView[]; versions: VersionView[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function remove(f: FaqView) {
    if (!window.confirm(`¿Borrar la pregunta «${f.question}»? Queda en las versiones por si hay que regresarla.`)) return;
    setError(null);
    const r = await deleteAgentFaq({ id: f.id });
    if (!r.ok) setError(r.message);
  }

  async function toggle(f: FaqView) {
    setError(null);
    const r = await updateAgentFaq({ id: f.id, question: f.question, answer: f.answer, enabled: !f.enabled });
    if (!r.ok) setError(r.message);
  }

  const q = filter.trim().toLowerCase();
  const shown = q ? faqs.filter((f) => `${f.question} ${f.answer}`.toLowerCase().includes(q)) : faqs;
  const active = faqs.filter((f) => f.enabled).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {faqs.length} preguntas · {active} activas
        </span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar pregunta…" aria-label="Buscar pregunta" className={`${input} ml-auto max-w-56 py-1 text-xs`} />
        <button
          type="button"
          onClick={() => setEditing("new")}
          disabled={editing === "new"}
          className="rounded border border-brand-navy/40 px-2 py-1 text-xs font-medium text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 dark:text-sky-300"
        >
          + Agregar pregunta
        </button>
      </div>
      {editing === "new" && (
        <FaqForm
          initial={{ question: "", answer: "", enabled: true }}
          submitLabel="Agregar"
          onSubmit={(v) => createAgentFaq(v)}
          onCancel={() => setEditing(null)}
        />
      )}
      <ul className="flex flex-col gap-2">
        {shown.map((f) =>
          editing === f.id ? (
            <li key={f.id}>
              <FaqForm initial={f} submitLabel="Guardar" onSubmit={(v) => updateAgentFaq({ id: f.id, ...v })} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={f.id} className={`rounded-md border border-black/10 p-3 dark:border-white/10 ${f.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-foreground">
                  {f.question}
                  {!f.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">(desactivada)</span>}
                </p>
                <span className="flex shrink-0 gap-1 text-xs">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={f.enabled}
                    onClick={() => void toggle(f)}
                    title={f.enabled ? "El agente la usa. Clic para desactivarla." : "El agente no la usa. Clic para activarla."}
                    className="rounded px-1.5 py-0.5 text-foreground/70 hover:bg-muted"
                  >
                    {f.enabled ? "Desactivar" : "Activar"}
                  </button>
                  <button type="button" onClick={() => setEditing(f.id)} className="rounded px-1.5 py-0.5 text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
                    Editar
                  </button>
                  <button type="button" onClick={() => void remove(f)} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted">
                    Borrar
                  </button>
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{f.answer}</p>
            </li>
          ),
        )}
      </ul>
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
      <VersionsList versions={versions} onRestore={(versionId) => restoreAgentFaqs({ versionId })} />
    </div>
  );
}
