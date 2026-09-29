"use client";

// Selector de fragmentos para el composer con la ventana de 24 h ABIERTA.
// Inserta el texto del fragmento en el borrador; el vendedor rellena las
// variables {{nombre}} a mano antes de enviar.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { listSnippets } from "@/lib/actions/snippets";
import type { SnippetView } from "@/lib/snippets/types";
import { CloseX } from "@/components/ui/close-x";

export function SnippetPicker({
  onInsert,
  onClose,
  commands = [],
  onRunCommand,
}: {
  onInsert: (body: string) => void;
  onClose: () => void;
  /** Comandos de Automatización ("/tabla"…): en móvil se listan aquí, porque escribir "/" en el celular es incómodo. */
  commands?: { id: string; name: string; command: string }[];
  onRunCommand?: (command: string) => void;
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
        if (alive) setError("No se pudieron cargar los mensajes rápidos.");
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
        <span className="text-sm font-semibold text-brand-orange">⚡ Mensajes rápidos</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar mensajes rápidos"
          className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
        >
          <X className="size-4" aria-hidden="true" />
          Cerrar
        </button>
        <CloseX size="sm" label="Cerrar mensajes rápidos" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {/* Móvil: los comandos de Automatización (tabla, videos, banco…) van primero; al
            tocar uno se ENVÍA el comando y el workflow manda su material. En escritorio
            se siguen usando con "/" (md:hidden). */}
        {commands.length > 0 && onRunCommand && (
          <div className="mb-3 md:hidden">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Automatizaciones · ▶ envía el material</p>
            <ul className="space-y-1">
              {commands.map((c) => (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onRunCommand(c.command)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:border-brand-navy hover:bg-brand-navy/5"
                  >
                    <span className="shrink-0 rounded bg-brand-navy px-1.5 py-0.5 font-mono text-[11px] text-brand-white">{c.command}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">▶</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Mensajes rápidos</p>
          </div>
        )}
        {error ? (
          <p className="py-4 text-center text-sm text-brand-orange">{error}</p>
        ) : snippets === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando mensajes rápidos…</p>
        ) : snippets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay mensajes rápidos. Créalos en la sección “Mensajes rápidos”.
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
