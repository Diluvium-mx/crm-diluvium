"use client";

// FAQs del agente (sección "Crear"): las preguntas frecuentes en una
// lista compacta tipo acordeón (una línea por pregunta; al dar clic se despliega la
// respuesta para verla o editarla), con buscador y filtro arriba. El panel se
// desliza por dentro: la página no crece con las FAQs. Cada cambio deja una versión
// de todas las FAQs (se puede regresar a una anterior). Sin lógica de datos.
import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { createAgentFaq, deleteAgentFaq, restoreAgentFaqs, updateAgentFaq } from "@/lib/actions/agente-ia-editor";
import { matchesSearch } from "@/lib/text/search";
import type { AgentActionResult, FaqView, VersionView } from "@/lib/agente-ia/types";
import { VersionsList } from "./versions-list";

const input =
  "w-full rounded border border-black/15 bg-background px-2 py-1.5 text-sm text-foreground dark:border-white/15";

type Filter = "todas" | "activas" | "inactivas";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "activas", label: "Activas" },
  { value: "inactivas", label: "Inactivas" },
];

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
        <button type="button" disabled={busy} onClick={onCancel} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        {error && <span className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</span>}
      </div>
    </div>
  );
}

// Interruptor compacto para activar/desactivar sin abrir la pregunta.
function EnabledSwitch({ faq, onToggle }: { faq: FaqView; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={faq.enabled}
      aria-label={faq.enabled ? `Desactivar «${faq.question}»` : `Activar «${faq.question}»`}
      title={faq.enabled ? "El agente la usa. Clic para desactivarla." : "El agente no la usa. Clic para activarla."}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${
        faq.enabled ? "bg-brand-navy dark:bg-primary" : "bg-black/20 dark:bg-white/20"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block size-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
          faq.enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function FaqEditor({ faqs, versions }: { faqs: FaqView[]; versions: VersionView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
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

  const active = faqs.filter((f) => f.enabled).length;
  const counts: Record<Filter, number> = { todas: faqs.length, activas: active, inactivas: faqs.length - active };
  // Sin acentos ni mayúsculas (regla de todo buscador: lib/text/search.ts).
  const shown = faqs.filter(
    (f) => (filter === "todas" || (filter === "activas") === f.enabled) && matchesSearch(`${f.question} ${f.answer}`, query),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en preguntas y respuestas…"
            aria-label="Buscar pregunta"
            className={`${input} py-1 pl-7 text-xs`}
          />
        </label>
        <div role="radiogroup" aria-label="Filtrar preguntas" className="flex rounded-md bg-muted p-0.5 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded px-2.5 py-1 transition-colors ${
                filter === f.value ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
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
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}

      {/* Solo el panel se desliza (overscroll-contain: al llegar al final no arrastra la página). */}
      <div className="max-h-[min(60vh,34rem)] overflow-y-auto overscroll-contain rounded-md border border-black/10 dark:border-white/10">
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {faqs.length === 0 ? "Todavía no hay preguntas. Agrega la primera." : "Ninguna pregunta coincide con la búsqueda o el filtro."}
          </p>
        ) : (
          <ul className="divide-y divide-black/10 dark:divide-white/10">
            {shown.map((f) => {
              const open = openId === f.id;
              const panelId = `faq-${f.id}`;
              return (
                <li key={f.id}>
                  <div className="flex items-center gap-2 pr-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => {
                        setOpenId(open ? null : f.id);
                        if (editing === f.id) setEditing(null);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm ${f.enabled ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      <ChevronRight
                        className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{f.question}</span>
                      {!f.enabled && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Inactiva</span>
                      )}
                    </button>
                    <EnabledSwitch faq={f} onToggle={() => void toggle(f)} />
                  </div>
                  {open && (
                    <div id={panelId} className="px-3 pb-3 pl-9">
                      {editing === f.id ? (
                        <FaqForm initial={f} submitLabel="Guardar" onSubmit={(v) => updateAgentFaq({ id: f.id, ...v })} onCancel={() => setEditing(null)} />
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap text-sm text-foreground/80">{f.answer}</p>
                          <div className="mt-2 flex gap-1 text-xs">
                            <button type="button" onClick={() => setEditing(f.id)} className="rounded px-2 py-0.5 font-medium text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
                              Editar
                            </button>
                            <button type="button" onClick={() => void remove(f)} className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted">
                              Borrar
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <VersionsList versions={versions} onRestore={(versionId) => restoreAgentFaqs({ versionId })} />
    </div>
  );
}
