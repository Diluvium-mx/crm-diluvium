"use client";

// Selector de fragmentos para el composer con la ventana de 24 h ABIERTA.
// Inserta el texto del fragmento en el borrador; el vendedor rellena las
// variables {{nombre}} a mano antes de enviar. En el orden que el equipo acomoda
// en Mensajes rápidos, con buscador y vista de lista o cuadrícula (se recuerda),
// igual que 📄 Plantillas (26-oct-2026).
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { listSnippets } from "@/lib/actions/snippets";
import type { SnippetView } from "@/lib/snippets/types";
import { matchesSearch } from "@/lib/text/search";
import { CloseX } from "@/components/ui/close-x";
import { usePersistentToggle } from "@/components/ui/use-persistent-toggle";
import { ViewToggle } from "@/components/ui/view-toggle";

export function SnippetPicker({
  onInsert,
  onClose,
}: {
  onInsert: (body: string) => void;
  onClose: () => void;
}) {
  const [snippets, setSnippets] = useState<SnippetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Vista recordada en esta computadora: false = lista, true = cuadrícula.
  const [grid, setGrid] = usePersistentToggle("mensajes-rapidos.cuadricula", false);

  useEffect(() => {
    let alive = true;
    listSnippets()
      .then((all) => {
        if (alive) setSnippets(all);
      })
      .catch(() => {
        if (alive) setError("No se pudieron cargar los mensajes rápidos.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(
    () => (snippets ?? []).filter((s) => matchesSearch(s.name, query) || matchesSearch(s.body, query)),
    [snippets, query],
  );

  return (
    // Mismo tope que el selector de plantillas: la mitad del chat (cqh).
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className="mb-2 flex max-h-[min(24rem,50cqh)] min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-md"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="truncate text-sm font-semibold text-brand-orange">⚡ Mensajes rápidos</span>
        <ViewToggle grid={grid} onChange={setGrid} label="Vista de los mensajes rápidos" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar mensajes rápidos"
          className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
        >
          <X className="size-4" aria-hidden="true" />
          Cerrar
        </button>
        <CloseX size="sm" label="Cerrar mensajes rápidos" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <p className="py-4 text-center text-sm text-brand-orange">{error}</p>
        ) : snippets === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando mensajes rápidos…</p>
        ) : snippets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay mensajes rápidos. Créalos en la sección “Mensajes rápidos”.
          </p>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 focus-within:border-brand-navy focus-within:ring-2 focus-within:ring-brand-navy/30">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar mensaje rápido"
                aria-label="Buscar mensaje rápido"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            {shown.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">Ningún mensaje rápido coincide con «{query.trim()}».</p>
            ) : (
              <ul className={grid ? "grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2" : "space-y-1"}>
                {shown.map((s) => (
                  <li key={s.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        onInsert(s.body);
                        onClose();
                      }}
                      className={`w-full min-w-0 rounded-md border px-3 py-2 text-left text-sm hover:border-brand-navy hover:bg-brand-navy/5 ${grid ? "flex h-full flex-col" : ""}`}
                    >
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className={`mt-0.5 block text-xs text-muted-foreground ${grid ? "line-clamp-4 break-words whitespace-pre-line" : "truncate"}`}>
                        {s.body}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
