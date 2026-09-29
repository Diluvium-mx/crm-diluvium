"use client";

// FAQs del agente (subpestaña "FAQs"): las preguntas frecuentes en una
// lista compacta tipo acordeón (una línea por pregunta; al dar clic se despliega la
// respuesta para verla o editarla y se queda abierta hasta cerrarla a mano: se pueden
// tener varias abiertas), con buscador, filtro y «Copiar» (todas, con su respuesta)
// arriba. Arriba de la lista, el botón «Seleccionar» muestra las casillas (sin él no se
// ven): «Seleccionar todas», «Cancelar» y «Borrar (N)» borran varias a la vez (28-sep-2026,
// pedido del dueño). El panel se
// desliza por dentro: la página no crece con las FAQs. Cada cambio deja una versión
// de todas las FAQs (se puede regresar a una anterior). Agregar, guardar una edición,
// borrar y activar/desactivar piden confirmación arriba antes de guardar (regla del
// dueño, 27-sep-2026; use-confirm.tsx). Sin lógica de datos.
import { useState } from "react";
import { ChevronRight, ListChecks, Search, Trash2 } from "lucide-react";
import { createAgentFaq, deleteAgentFaq, deleteAgentFaqs, restoreAgentFaqs, updateAgentFaq } from "@/lib/actions/agente-ia-editor";
import { faqSchema, faqsAsText } from "@/lib/agente-ia/editor";
import { CopyButton } from "@/components/ui/copy-button";
import { matchesSearch } from "@/lib/text/search";
import type { FaqView, VersionView } from "@/lib/agente-ia/types";
import { useConfirm } from "./use-confirm";
import { VersionsList } from "./versions-list";
import { LinkedText } from "@/components/ui/linked-text";

const input =
  "w-full rounded border border-black/15 bg-background px-2 py-1.5 text-sm text-foreground dark:border-white/15";

type Filter = "todas" | "activas" | "inactivas";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "activas", label: "Activas" },
  { value: "inactivas", label: "Inactivas" },
];

type FaqValues = { question: string; answer: string; enabled: boolean };

// Formulario de una FAQ (nueva o en edición). No guarda: «Agregar»/«Guardar» piden
// confirmación a FaqEditor; el error de ese guardado llega por `error`.
function FaqForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: FaqValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (v: FaqValues) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [enabled, setEnabled] = useState(initial.enabled);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-brand-navy/30 bg-brand-navy/5 p-3">
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pregunta" aria-label="Pregunta" className={input} />
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Respuesta" aria-label="Respuesta" rows={4} className={`${input} resize-y`} />
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--brand-navy)]" />
        Activa (el agente la usa)
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onSubmit({ question, answer, enabled })}
          className="rounded bg-brand-orange px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
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

// «¿Agregar la pregunta «¿Precio?»?»: la pregunta va recortada (máx. 80 caracteres).
function short(question: string): string {
  const q = question.trim();
  return q.length > 80 ? `${q.slice(0, 79)}…` : q;
}

export function FaqEditor({ faqs, versions }: { faqs: FaqView[]; versions: VersionView[] }) {
  // Abiertas: cada una se queda así hasta cerrarla a mano (pedido del dueño, 28-sep-2026).
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  // Modo selección: las casillas solo se ven después de pulsar «Seleccionar»; «Cancelar» o
  // terminar de borrar las quitan. Seleccionadas para «Borrar (N)»: cambiar la búsqueda o el
  // filtro las vacía, así nunca se borra una pregunta que no está a la vista.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }
  const confirm = useConfirm();

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function forget(ids: readonly string[]) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
    if (editing !== null && ids.includes(editing)) setEditing(null);
  }

  // Lo mismo que valida el servidor: una pregunta sin texto ni siquiera abre el pop-up.
  function invalid(v: FaqValues, scope: string): boolean {
    const check = faqSchema.safeParse(v);
    if (check.success) return false;
    confirm.fail(check.error.issues[0]?.message ?? "Revisa la pregunta y la respuesta.", scope);
    return true;
  }

  function add(v: FaqValues) {
    if (invalid(v, "new")) return;
    confirm.ask({
      title: `¿Agregar la pregunta «${short(v.question)}»?`,
      body: v.enabled
        ? "El agente la usa desde el siguiente mensaje. Queda una versión de las FAQs."
        : "Queda inactiva: el agente no la usa hasta que la actives. Queda una versión de las FAQs.",
      confirmLabel: "Sí, agregar",
      pendingLabel: "Agregando…",
      done: "Listo: pregunta agregada",
      scope: "new",
      run: () => createAgentFaq(v),
      onDone: () => setEditing(null),
    });
  }

  function saveEdit(f: FaqView, v: FaqValues) {
    if (invalid(v, f.id)) return;
    if (v.question.trim() === f.question && v.answer.trim() === f.answer && v.enabled === f.enabled) {
      setEditing(null);
      return;
    }
    confirm.ask({
      title: `¿Guardar los cambios de «${short(v.question)}»?`,
      body: v.enabled
        ? "El agente usa la pregunta así desde el siguiente mensaje. Queda una versión de las FAQs."
        : "Queda inactiva: el agente no la usa. Queda una versión de las FAQs.",
      confirmLabel: "Sí, guardar",
      pendingLabel: "Guardando…",
      done: "Listo: pregunta guardada",
      scope: f.id,
      run: () => updateAgentFaq({ id: f.id, ...v }),
      onDone: () => setEditing(null),
    });
  }

  function remove(f: FaqView) {
    confirm.ask({
      title: `¿Borrar la pregunta «${short(f.question)}»?`,
      body: "El agente deja de usarla desde el siguiente mensaje. Queda en las versiones por si hay que regresarla.",
      confirmLabel: "Sí, borrar",
      pendingLabel: "Borrando…",
      done: "Listo: pregunta borrada",
      scope: "list",
      run: () => deleteAgentFaq({ id: f.id }),
      onDone: () => forget([f.id]),
    });
  }

  function removeSelected(list: FaqView[]) {
    const n = list.length;
    if (n === 0) return;
    const ids = list.map((f) => f.id);
    confirm.ask({
      title:
        n === 1
          ? `¿Borrar la pregunta «${short(list[0].question)}»?`
          : n === faqs.length
            ? `¿Borrar las ${n} preguntas (todas)?`
            : `¿Borrar ${n} preguntas?`,
      body: `El agente deja de ${n === 1 ? "usarla" : "usarlas"} desde el siguiente mensaje. Queda una versión con las de antes (abajo, «Versiones») por si hay que regresarlas.`,
      confirmLabel: "Sí, borrar",
      pendingLabel: "Borrando…",
      done: n === 1 ? "Listo: pregunta borrada" : `Listo: ${n} preguntas borradas`,
      scope: "list",
      run: () => deleteAgentFaqs({ ids }),
      onDone: () => {
        forget(ids);
        setSelecting(false);
      },
    });
  }

  function toggle(f: FaqView) {
    confirm.ask({
      title: f.enabled ? `¿Desactivar «${short(f.question)}»?` : `¿Activar «${short(f.question)}»?`,
      body: f.enabled
        ? "El agente deja de usarla desde el siguiente mensaje (no se borra; se puede activar otra vez)."
        : "El agente la usa desde el siguiente mensaje.",
      confirmLabel: f.enabled ? "Sí, desactivar" : "Sí, activar",
      pendingLabel: "Guardando…",
      done: f.enabled ? "Listo: pregunta desactivada" : "Listo: pregunta activada",
      scope: "list",
      run: () => updateAgentFaq({ id: f.id, question: f.question, answer: f.answer, enabled: !f.enabled }),
    });
  }

  const active = faqs.filter((f) => f.enabled).length;
  const counts: Record<Filter, number> = { todas: faqs.length, activas: active, inactivas: faqs.length - active };
  // Sin acentos ni mayúsculas (regla de todo buscador: lib/text/search.ts).
  const shown = faqs.filter(
    (f) => (filter === "todas" || (filter === "activas") === f.enabled) && matchesSearch(`${f.question} ${f.answer}`, query),
  );
  const selectedShown = shown.filter((f) => selected.has(f.id));
  const allSelected = shown.length > 0 && selectedShown.length === shown.length;
  const someSelected = selectedShown.length > 0 && !allSelected;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(new Set());
            }}
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
              onClick={() => {
                setFilter(f.value);
                setSelected(new Set());
              }}
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
        {/* Esquina de arriba a la derecha: TODAS las FAQs (sin importar búsqueda ni filtro). */}
        {faqs.length > 0 && (
          <CopyButton
            getText={() => faqsAsText(faqs)}
            title={`Copiar las ${faqs.length} preguntas con su respuesta`}
            className="ml-auto"
          />
        )}
      </div>

      {editing === "new" && (
        <FaqForm
          initial={{ question: "", answer: "", enabled: true }}
          submitLabel="Agregar"
          pending={confirm.pending}
          error={confirm.errorFor("new")}
          onSubmit={add}
          onCancel={() => {
            setEditing(null);
            confirm.clearError();
          }}
        />
      )}
      {confirm.errorFor("list") && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.errorFor("list")}</p>}

      {/* Solo el panel se desliza (overscroll-contain: al llegar al final no arrastra la página). */}
      <div className="max-h-[min(60vh,34rem)] overflow-y-auto overscroll-contain rounded-md border border-black/10 dark:border-white/10">
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {faqs.length === 0 ? "Todavía no hay preguntas. Agrega la primera." : "Ninguna pregunta coincide con la búsqueda o el filtro."}
          </p>
        ) : (
          <>
            {/* Barra fija arriba del panel. Sin modo selección: solo «Seleccionar». Con él:
                «Seleccionar todas» (las de la lista a la vista), «Cancelar» y «Borrar (N)». */}
            <div className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-black/10 bg-card px-3 py-1.5 text-xs dark:border-white/10">
              {!selecting ? (
                <button
                  type="button"
                  onClick={() => setSelecting(true)}
                  className="inline-flex items-center gap-1.5 rounded border border-black/15 px-2 py-1 font-medium text-foreground hover:bg-muted dark:border-white/15"
                >
                  <ListChecks className="size-3.5" aria-hidden="true" />
                  Seleccionar
                </button>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((f) => f.id)))}
                      aria-label={allSelected ? "Quitar la selección" : `Seleccionar las ${shown.length} preguntas de la lista`}
                      className="size-4 accent-[var(--brand-navy)]"
                    />
                    {selectedShown.length > 0 ? (
                      <span className="font-medium text-foreground">
                        {selectedShown.length} {selectedShown.length === 1 ? "seleccionada" : "seleccionadas"}
                      </span>
                    ) : (
                      <span>
                        Seleccionar todas <span className="tabular-nums opacity-70">{shown.length}</span>
                      </span>
                    )}
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={stopSelecting} className="rounded px-2 py-1 text-muted-foreground hover:bg-muted">
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSelected(selectedShown)}
                      disabled={confirm.pending || selectedShown.length === 0}
                      title={selectedShown.length === 0 ? "Marca al menos una pregunta" : undefined}
                      className="inline-flex items-center gap-1.5 rounded border border-red-300 px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Borrar ({selectedShown.length})
                    </button>
                  </div>
                </>
              )}
            </div>
            <ul className="divide-y divide-black/10 dark:divide-white/10">
              {shown.map((f) => {
                const open = openIds.has(f.id);
                const panelId = `faq-${f.id}`;
                return (
                  <li key={f.id} className={selecting && selected.has(f.id) ? "bg-brand-navy/5 dark:bg-white/5" : undefined}>
                    <div className="flex items-center gap-2 pr-2">
                      {selecting && (
                        <input
                          type="checkbox"
                          checked={selected.has(f.id)}
                          onChange={() => toggleSelected(f.id)}
                          aria-label={`Seleccionar «${short(f.question)}»`}
                          className="ml-3 size-4 shrink-0 cursor-pointer accent-[var(--brand-navy)]"
                        />
                      )}
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => {
                          setOpenIds((current) => {
                            const next = new Set(current);
                            if (open) next.delete(f.id);
                            else next.add(f.id);
                            return next;
                          });
                          if (open && editing === f.id) setEditing(null);
                        }}
                        className={`flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left text-sm ${selecting ? "" : "pl-3"} ${f.enabled ? "text-foreground" : "text-muted-foreground"}`}
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
                      <EnabledSwitch faq={f} onToggle={() => toggle(f)} />
                    </div>
                    {open && (
                      <div id={panelId} className={`px-3 pb-3 ${selecting ? "pl-[3.25rem]" : "pl-9"}`}>
                        {editing === f.id ? (
                          <FaqForm
                            initial={f}
                            submitLabel="Guardar"
                            pending={confirm.pending}
                            error={confirm.errorFor(f.id)}
                            onSubmit={(v) => saveEdit(f, v)}
                            onCancel={() => {
                              setEditing(null);
                              confirm.clearError();
                            }}
                          />
                        ) : (
                          <>
                            <p className="whitespace-pre-wrap text-sm text-foreground/80">
                              <LinkedText text={f.answer} />
                            </p>
                            <div className="mt-2 flex gap-1 text-xs">
                              <button type="button" onClick={() => setEditing(f.id)} className="rounded px-2 py-0.5 font-medium text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
                                Editar
                              </button>
                              <button type="button" onClick={() => remove(f)} className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted">
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
          </>
        )}
      </div>

      <VersionsList versions={versions} onRestore={(versionId) => restoreAgentFaqs({ versionId })} />
      {confirm.ui}
    </div>
  );
}
