"use client";

// Selector de fragmentos para el composer con la ventana de 24 h ABIERTA.
// Inserta el texto del fragmento en el borrador; el vendedor rellena las
// variables {{nombre}} a mano antes de enviar.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { listSnippets } from "@/lib/actions/snippets";
import type { SnippetView } from "@/lib/snippets/types";

export function SnippetPicker({
  onInsert,
  onClose,
}: {
  onInsert: (body: string) => void;
  onClose: () => void;
}) {
  const [snippets, setSnippets] = useState<SnippetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listSnippets()
      .then((all) => {
        if (alive) setSnippets(all);
      })
      .catch(() => {
        if (alive) setError("No se pudieron cargar los fragmentos.");
      });
    return () => {
      alive = false;
    };
  }, []);

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
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
        <span className="text-sm font-semibold text-brand-orange">⚡ Fragmentos</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar fragmentos"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
          Cerrar
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <p className="py-4 text-center text-sm text-brand-orange">{error}</p>
        ) : snippets === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando fragmentos…</p>
        ) : snippets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay fragmentos. Créalos en “Mensajes rápidos”.
          </p>
        ) : (
          <ul className="space-y-1">
            {snippets.map((s) => (
              <li key={s.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    onInsert(s.body);
                    onClose();
                  }}
                  className="w-full min-w-0 rounded-md border px-3 py-2 text-left text-sm hover:border-brand-navy hover:bg-brand-navy/5"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{s.body}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
