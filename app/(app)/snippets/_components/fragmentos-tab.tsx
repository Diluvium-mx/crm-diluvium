"use client";

// Fragmentos ⚡: respuestas reutilizables a nivel organización, con variables
// {{nombre}}. Se crean, editan y borran aquí mismo. Todo el equipo comparte los
// mismos (CLAUDE.md §5). Para responder DENTRO de la ventana de 24 h.
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createSnippet, deleteSnippet, updateSnippet } from "@/lib/actions/snippets";
import { extractVariables } from "@/lib/snippets/variables";
import type { SnippetView } from "@/lib/snippets/types";
import { HighlightBody } from "./highlight";

type Draft = { id?: string; name: string; body: string };

const TOKEN_CLASS = "rounded bg-brand-orange/15 px-1 font-medium text-brand-orange";

export function FragmentosTab({ initial }: { initial: SnippetView[] }) {
  const [items, setItems] = useState<SnippetView[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = useMemo(() => (draft ? extractVariables(draft.body) : []), [draft]);

  function openNew() {
    setError(null);
    setDraft({ name: "", body: "" });
  }
  function openEdit(snippet: SnippetView) {
    setError(null);
    setDraft({ id: snippet.id, name: snippet.name, body: snippet.body });
  }

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const body = draft.body.trim();
    if (!name || !body) {
      setError("El nombre y el fragmento son obligatorios.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (draft.id) {
        const updated = await updateSnippet({ id: draft.id, name, body });
        setItems((current) => current.map((s) => (s.id === updated.id ? updated : s)).sort(byName));
      } else {
        const created = await createSnippet({ name, body });
        setItems((current) => [...current, created].sort(byName));
      }
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el fragmento.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(snippet: SnippetView) {
    if (!window.confirm(`¿Borrar el fragmento "${snippet.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSnippet(snippet.id);
      setItems((current) => current.filter((s) => s.id !== snippet.id));
      if (draft?.id === snippet.id) setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el fragmento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Respuestas rápidas con variables <code className="text-brand-orange">{"{{nombre}}"}</code>, para
          responder dentro de las 24 h.
        </p>
        {!draft && (
          <button
            type="button"
            onClick={openNew}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-orange-light"
          >
            <Plus className="size-4" aria-hidden="true" /> Nuevo fragmento
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {draft && (
        <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
          <div className="space-y-1">
            <label htmlFor="snippet-name" className="text-xs font-medium text-muted-foreground">
              Nombre
            </label>
            <input
              id="snippet-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
              placeholder="p. ej. saludo, envío culiacán"
              maxLength={60}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/30"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="snippet-body" className="text-xs font-medium text-muted-foreground">
              Fragmento
            </label>
            <textarea
              id="snippet-body"
              value={draft.body}
              onChange={(e) => setDraft((d) => (d ? { ...d, body: e.target.value } : d))}
              placeholder="Hola {{nombre}}, gracias por escribir a Diluvium…"
              rows={4}
              maxLength={2000}
              className="min-h-[96px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/30"
            />
          </div>
          {detected.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Variables:</span>
              {detected.map((v) => (
                <span key={v} className={TOKEN_CLASS}>{`{{${v}}}`}</span>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={busy}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.name.trim() || !draft.body.trim()}
              className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-50"
            >
              {busy ? "Guardando…" : draft.id ? "Guardar cambios" : "Crear fragmento"}
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && !draft ? (
        <div className="rounded-lg border border-dashed bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Aún no hay fragmentos. Crea el primero para responder más rápido.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((snippet) => (
            <li key={snippet.id} className="rounded-lg border bg-card p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{snippet.name}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">
                    <HighlightBody body={snippet.body} tokenClassName={TOKEN_CLASS} />
                  </p>
                  {snippet.variables.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {snippet.variables.map((v) => (
                        <span key={v} className={TOKEN_CLASS}>{`{{${v}}}`}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(snippet)}
                    aria-label={`Editar ${snippet.name}`}
                    title="Editar"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(snippet)}
                    aria-label={`Borrar ${snippet.name}`}
                    title="Borrar"
                    className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function byName(a: SnippetView, b: SnippetView): number {
  return a.name.localeCompare(b.name, "es");
}
