"use client";

// Composer del chat (Bandeja y pop-up del Embudo). Separado de chat-thread.tsx
// para que el hilo (burbujas) y el composer evolucionen por separado.
// - Ventana de 24 h ABIERTA: texto libre, ⚡ Fragmentos, 📄 Plantillas y "/"
//   para buscar fragmentos mientras se escribe (↑↓ elige, Enter inserta, Esc
//   cierra), como las respuestas rápidas de GHL.
// - Ventana CERRADA: solo plantilla (docs/investigacion/plantillas-zernio.md).
// Al insertar un fragmento, {{vendedor}} se rellena con el nombre del usuario
// logueado; las demás variables las completa el vendedor a mano.
import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { useSession } from "@/lib/auth/client";
import { listSnippets } from "@/lib/actions/snippets";
import { applySlashInsert, filterSnippets, findSlashQuery } from "@/lib/snippets/slash";
import type { SnippetView } from "@/lib/snippets/types";
import { renderSnippet } from "@/lib/snippets/variables";
import { SnippetPicker } from "./snippet-picker";
import { TemplatePicker } from "./template-picker";

export function Composer({
  windowOpen,
  onSendText,
  onSendTemplate,
}: {
  windowOpen: boolean;
  onSendText: (text: string) => void;
  onSendTemplate: (templateId: string, values: string[], preview: string) => void;
}) {
  const { data: session } = useSession();
  const sellerName = session?.user.name?.trim() ?? "";

  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [snippets, setSnippets] = useState<SnippetView[] | null>(null);
  const [snippetsError, setSnippetsError] = useState(false);
  const [active, setActive] = useState(0);
  // "/" que el vendedor cerró con Esc: no se vuelve a abrir mientras siga ahí.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const found = windowOpen ? findSlashQuery(draft, caret) : null;
  const slash = found && found.start !== dismissedAt ? found : null;
  const slashOpen = slash !== null;
  const slashQuery = slash?.query ?? null;
  const matches = slashQuery !== null && snippets ? filterSnippets(snippets, slashQuery) : [];

  // Carga los fragmentos la primera vez que se abre el buscador con "/".
  useEffect(() => {
    if (!slashOpen || snippets !== null || snippetsError) return;
    let alive = true;
    listSnippets()
      .then((all) => {
        if (alive) setSnippets(all);
      })
      .catch(() => {
        if (alive) setSnippetsError(true);
      });
    return () => {
      alive = false;
    };
  }, [slashOpen, snippets, snippetsError]);

  // Coloca el cursor después de insertar (tras el render del nuevo borrador).
  useEffect(() => {
    const el = textareaRef.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [draft]);

  function fill(body: string): string {
    return sellerName ? renderSnippet(body, { vendedor: sellerName }) : body;
  }

  function updateDraft(value: string, nextCaret: number) {
    setDraft(value);
    setCaret(nextCaret);
    setActive(0);
    // Si el "/" cerrado ya no está en su lugar, se olvida el cierre.
    if (dismissedAt !== null && value[dismissedAt] !== "/") setDismissedAt(null);
  }

  // Fragmento desde el botón ⚡: se agrega al final del borrador.
  function appendFragment(body: string) {
    const text = fill(body);
    const next = draft.trim() ? `${draft.replace(/\s*$/, "")} ${text}` : text;
    pendingCaret.current = next.length;
    updateDraft(next, next.length);
  }

  // Fragmento desde "/": reemplaza "/búsqueda" en su lugar.
  function insertFromSlash(snippet: SnippetView) {
    if (!slash) return;
    const { text, caret: nextCaret } = applySlashInsert(draft, slash, fill(snippet.body));
    pendingCaret.current = nextCaret;
    updateDraft(text, nextCaret);
  }

  function submit() {
    const text = draft.trim();
    if (!text || !windowOpen) return;
    updateDraft("", 0);
    onSendText(text);
  }

  if (!windowOpen) {
    return (
      <div className="border-t bg-card p-3">
        {templateOpen ? (
          <TemplatePicker
            onSubmit={(templateId, values, preview) => {
              setTemplateOpen(false);
              onSendTemplate(templateId, values, preview);
            }}
            onClose={() => setTemplateOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setTemplateOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark"
          >
            📄 Enviar plantilla
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="border-t bg-card p-3">
      {snippetOpen && <SnippetPicker onInsert={appendFragment} onClose={() => setSnippetOpen(false)} />}
      {templateOpen && (
        <div className="mb-2">
          <TemplatePicker
            onSubmit={(templateId, values, preview) => {
              setTemplateOpen(false);
              onSendTemplate(templateId, values, preview);
            }}
            onClose={() => setTemplateOpen(false)}
          />
        </div>
      )}

      {slashOpen && (
        <div className="mb-2 overflow-hidden rounded-lg border bg-background shadow-sm">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
            <span className="font-semibold text-brand-orange">⚡ Fragmentos</span>
            <span className="text-muted-foreground">↑↓ elegir · Enter insertar · Esc cerrar</span>
          </div>
          {snippetsError ? (
            <p className="px-3 py-3 text-sm text-brand-orange">No se pudieron cargar los fragmentos.</p>
          ) : snippets === null ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Cargando fragmentos…</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {snippets.length === 0 ? "No hay fragmentos. Créalos en “Mensajes rápidos”." : "Sin coincidencias."}
            </p>
          ) : (
            <ul role="listbox" aria-label="Fragmentos" className="max-h-56 overflow-y-auto py-1">
              {matches.map((s, i) => (
                <li key={s.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    // mousedown: que el textarea no pierda el foco antes de insertar.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertFromSlash(s);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`w-full px-3 py-1.5 text-left text-sm ${i === active ? "bg-brand-orange/10" : ""}`}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => {
            setSnippetOpen((open) => !open);
            setTemplateOpen(false);
          }}
          aria-label="Insertar fragmento"
          aria-expanded={snippetOpen}
          title="Fragmentos"
          className={`rounded-md border px-2.5 py-2 transition-colors ${
            snippetOpen ? "border-brand-orange bg-brand-orange/10 text-brand-orange" : "text-brand-orange hover:bg-brand-orange/10"
          }`}
        >
          <Zap className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setTemplateOpen((open) => !open);
            setSnippetOpen(false);
          }}
          aria-label="Enviar plantilla"
          aria-expanded={templateOpen}
          title="Plantillas (aprobadas por Meta)"
          className={`rounded-md border px-2.5 py-2 text-sm leading-4 transition-colors ${
            templateOpen ? "border-brand-navy bg-brand-navy/10" : "hover:bg-brand-navy/10"
          }`}
        >
          <span aria-hidden="true">📄</span>
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (slash && matches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => (i + 1) % matches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => (i - 1 + matches.length) % matches.length);
                return;
              }
              if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                event.preventDefault();
                insertFromSlash(matches[Math.min(active, matches.length - 1)]);
                return;
              }
            }
            if (slash && event.key === "Escape") {
              event.preventDefault();
              setDismissedAt(slash.start);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          aria-autocomplete="list"
          placeholder="Escribe un mensaje… (/ busca fragmentos · Enter envía · Shift+Enter salto de línea)"
          className="max-h-32 min-h-[40px] flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
