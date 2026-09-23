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
    <div className="mb-2 rounded-lg border bg-background shadow-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold text-brand-orange">⚡ Fragmentos</span>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto p-3">
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
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    onInsert(s.body);
                    onClose();
                  }}
                  className="w-full rounded-md border px-3 py-2 text-left text-sm hover:border-brand-orange hover:bg-brand-orange/5"
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
