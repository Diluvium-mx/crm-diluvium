"use client";

// Fragmentos ⚡: respuestas reutilizables a nivel organización, con variables
// {{nombre}}. Se crean, editan y borran aquí mismo. Todo el equipo comparte los
// mismos (CLAUDE.md §5). Para responder DENTRO de la ventana de 24 h.
// 26-oct-2026 (pedido del dueño): buscador, vista de lista o cuadrícula (como 📄 Plantillas del chat) y orden
// manual arrastrando ⋮⋮; ese orden es el de ⚡ del chat y el de «/». Uno nuevo va al final.
import { useMemo, useRef, useState } from "react";
import { GripVertical, Plus, Search } from "lucide-react";
import { createSnippet, deleteSnippet, reorderSnippets, updateSnippet } from "@/lib/actions/snippets";
import { moveItem } from "@/lib/snippets/orden";
import { extractVariables } from "@/lib/snippets/variables";
import { matchesSearch } from "@/lib/text/search";
import { mensajeDeFalla } from "@/lib/version/client";
import type { SnippetView } from "@/lib/snippets/types";
import { FragmentosLista, TOKEN_CLASS } from "./fragmentos-lista";
import { CloseX } from "@/components/ui/close-x";
import { usePersistentToggle } from "@/components/ui/use-persistent-toggle";
import { ViewToggle } from "@/components/ui/view-toggle";
import { SpellcheckOverlay } from "@/components/spelling/spellcheck-overlay";

type Draft = { id?: string; name: string; body: string };

export function FragmentosTab({ initial, canManage }: { initial: SnippetView[]; canManage: boolean }) {
  const [items, setItems] = useState<SnippetView[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Vista recordada en esta computadora: false = lista, true = cuadrícula.
  const [grid, setGrid] = usePersistentToggle("mensajes-rapidos.pagina.cuadricula", false);
  // Solo cuenta la respuesta del último acomodo (si arrastra dos seguidos, la primera no regresa la lista vieja).
  const lastMove = useRef(0);

  const detected = useMemo(() => (draft ? extractVariables(draft.body) : []), [draft]);
  const shown = useMemo(() => items.filter((s) => matchesSearch(s.name, query) || matchesSearch(s.body, query)), [items, query]);
  const sortable = canManage && !query.trim() && items.length > 1;

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
      setError("El nombre y el mensaje son obligatorios.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (draft.id) {
        const updated = await updateSnippet({ id: draft.id, name, body });
        setItems((current) => current.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const created = await createSnippet({ name, body });
        setItems((current) => [...current, created]);
      }
      setDraft(null);
    } catch (err) {
      setError(await mensajeDeFalla(err, err instanceof Error ? err.message : "No se pudo guardar el mensaje rápido."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(snippet: SnippetView) {
    if (!window.confirm(`¿Borrar el mensaje rápido "${snippet.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSnippet(snippet.id);
      setItems((current) => current.filter((s) => s.id !== snippet.id));
      if (draft?.id === snippet.id) setDraft(null);
    } catch (err) {
      setError(await mensajeDeFalla(err, err instanceof Error ? err.message : "No se pudo borrar el mensaje rápido."));
    } finally {
      setBusy(false);
    }
  }

  // Al soltar: cambia al momento y el servidor confirma; si no se pudo, regresa como estaba y lo dice.
  async function move(fromId: string, toId: string) {
    const before = items;
    const next = moveItem(before, before.findIndex((s) => s.id === fromId), before.findIndex((s) => s.id === toId));
    if (next.every((s, i) => s === before[i])) return;
    setItems(next);
    setError(null);
    const ticket = ++lastMove.current;
    try {
      const saved = await reorderSnippets({ ids: next.map((s) => s.id) });
      if (ticket === lastMove.current) setItems(saved);
    } catch (err) {
      if (ticket !== lastMove.current) return;
      setItems(before);
      setError(await mensajeDeFalla(err, err instanceof Error ? err.message : "No se pudo guardar el orden."));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          En un chat, escribe <code className="text-brand-orange">/</code> y parte del nombre (ej.{" "}
          <code className="text-brand-orange">/precio</code>) o toca ⚡. El texto se pone en la caja: lo revisas y le
          das Enviar.
        </p>
        {canManage && !draft && (
          <button
            type="button"
            onClick={openNew}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-orange-light"
          >
            <Plus className="size-4" aria-hidden="true" /> Nuevo mensaje rápido
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
          {/* Móvil: título del formulario y ✕ roja para cerrarlo (abajo sigue Cancelar). */}
          <div className="flex items-center justify-between gap-2 md:hidden">
            <h2 className="text-sm font-semibold">{draft.id ? "Editar mensaje rápido" : "Nuevo mensaje rápido"}</h2>
            <CloseX always size="sm" label="Cerrar formulario" onClick={() => setDraft(null)} />
          </div>
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
              Mensaje
            </label>
            <SpellcheckOverlay textareaRef={bodyRef} value={draft.body} />
            <textarea
              ref={bodyRef}
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
              {busy ? "Guardando…" : draft.id ? "Guardar cambios" : "Crear mensaje rápido"}
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && !draft ? (
        <div className="rounded-lg border border-dashed bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          {canManage
            ? "Aún no hay mensajes rápidos. Crea el primero para responder más rápido."
            : "Aún no hay mensajes rápidos. Un administrador puede crearlos; tú los usarás desde el chat."}
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2 py-1.5 focus-within:border-brand-navy focus-within:ring-2 focus-within:ring-brand-navy/30">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar mensaje rápido"
                aria-label="Buscar mensaje rápido"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <ViewToggle grid={grid} onChange={setGrid} label="Vista de los mensajes rápidos" />
          </div>
          {canManage && items.length > 1 && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {query.trim() ? (
                "Para cambiar el orden, borra la búsqueda."
              ) : (
                <>
                  Arrastra <GripVertical className="size-3.5" aria-label="la manija" /> para cambiar el orden: así salen en el chat.
                </>
              )}
            </p>
          )}
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Ningún mensaje rápido coincide con «{query.trim()}».</p>
          ) : (
            <FragmentosLista
              items={shown}
              grid={grid}
              sortable={sortable && !busy}
              canManage={canManage}
              onEdit={openEdit}
              onRemove={(snippet) => void remove(snippet)}
              onMove={(fromId, toId) => void move(fromId, toId)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
