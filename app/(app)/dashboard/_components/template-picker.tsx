"use client";

// Selector de plantillas para el composer cuando la ventana de 24 h está
// CERRADA (solo se pueden mandar plantillas aprobadas por Meta). Carga las
// aprobadas, deja rellenar las variables posicionales y las manda al composer,
// que hace el envío optimista (igual que el texto). Lo usan también el 🕒
// Programar mensaje y el primer mensaje de Contactos. La lista va por secciones
// (lib/templates/labels.ts), con buscador y vista de lista o cuadrícula (se recuerda).
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LayoutGrid, List, Search, X } from "lucide-react";
import { listTemplates } from "@/lib/actions/templates";
import { renderTemplateBody } from "@/lib/messaging/template-format";
import type { TemplateView } from "@/lib/templates/types";
import { CloseX } from "@/components/ui/close-x";
import { LinkedText } from "@/components/ui/linked-text";
import { PICKER_TIME_PHRASE_TEMPLATES } from "@/lib/followups/cases";
import { groupTemplates, templateSnippet, templateTitle } from "@/lib/templates/labels";
import { usePersistentToggle } from "@/components/ui/use-persistent-toggle";

const TOKEN_CLASS = "rounded bg-brand-navy/15 px-1 font-medium text-brand-navy dark:bg-sky-300/15 dark:text-sky-300";

/** Texto de la plantilla con los {{n}} resaltados. */
function BodyWithTokens({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\{\s*\d+\s*\}\})/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={TOKEN_CLASS}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function TemplatePicker({
  onSubmit,
  onClose,
  submitLabel = "Enviar plantilla",
  busy = false,
  firstName = "",
  timePhrase = "",
}: {
  onSubmit: (templateId: string, values: string[], preview: string) => void;
  onClose: () => void;
  /** Texto del botón final (p. ej. "Programar plantilla" en A6). */
  submitLabel?: string;
  /** Hay un envío en curso: el botón final queda deshabilitado (sin doble envío). */
  busy?: boolean;
  /** Primer nombre del contacto: llena solo el hueco {{1}} al elegir la plantilla (se puede cambiar). */
  firstName?: string;
  /**
   * Cuándo nos escribió el cliente ("el día de ayer", "anoche"…): en las plantillas de seguimiento
   * con tiempo (PICKER_TIME_PHRASE_TEMPLATES: seg_* y daniel_*) su {{1}} es ESTO, no el nombre (3-oct-2026). Se puede cambiar.
   */
  timePhrase?: string;
}) {
  const [templates, setTemplates] = useState<TemplateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  // Vista recordada en esta computadora: false = lista, true = cuadrícula.
  const [grid, setGrid] = usePersistentToggle("plantillas.cuadricula", false);

  useEffect(() => {
    let alive = true;
    listTemplates()
      .then((all) => {
        if (alive) setTemplates(all.filter((t) => t.sendable));
      })
      .catch(() => {
        if (alive) setError("No se pudieron cargar las plantillas.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => templates?.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  function select(template: TemplateView) {
    setSelectedId(template.id);
    const first = PICKER_TIME_PHRASE_TEMPLATES.has(template.name) ? timePhrase : firstName;
    setValues(template.variables.map((_, i) => (i === 0 ? first : "")));
  }

  const sections = useMemo(() => groupTemplates(templates ?? [], query), [templates, query]);

  const preview = selected?.bodyText ? renderTemplateBody(selected.bodyText, values) : selected?.bodyText ?? "";
  const ready = selected !== null && values.length === (selected?.variables.length ?? 0) && values.every((v) => v.trim().length > 0);

  return (
    // Alto tope = la mitad del chat (cqh: el chat es el contenedor, chat-thread.tsx):
    // el historial sigue a la vista en la Bandeja y en el pop-up del Embudo. El
    // encabezado (con Cerrar) y el botón final no se desplazan; solo la lista.
    // Esc cierra (o regresa a la lista si hay una plantilla elegida).
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (selected) setSelectedId(null);
        else onClose();
      }}
      className="mb-2 flex max-h-[min(24rem,50cqh)] min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-md"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {selected && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Volver a la lista"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
          )}
          <span className="truncate text-sm font-semibold text-brand-navy dark:text-sky-300">
            📄 {selected ? templateTitle(selected.name) : "Elegir plantilla"}
          </span>
        </div>
        {!selected && (
          <div role="radiogroup" aria-label="Vista de las plantillas" className="ml-auto flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5">
            {([false, true] as const).map((isGrid) => {
              const Icon = isGrid ? LayoutGrid : List;
              const label = isGrid ? "Cuadrícula" : "Lista";
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={grid === isGrid}
                  aria-label={label}
                  title={label}
                  onClick={() => setGrid(isGrid)}
                  className={`rounded p-1 ${grid === isGrid ? "bg-card text-brand-navy shadow-sm dark:text-sky-300" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar plantillas"
          className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
        >
          <X className="size-4" aria-hidden="true" />
          Cerrar
        </button>
        <CloseX size="sm" label="Cerrar plantillas" onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <p className="py-4 text-center text-sm text-brand-orange">{error}</p>
        ) : templates === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando plantillas…</p>
        ) : selected ? (
          <div className="space-y-3">
            {selected.variables.map((variable, i) => (
              <div key={variable.index} className="space-y-1">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className={TOKEN_CLASS}>{`{{${variable.index}}}`}</span>
                  {variable.example ? `ej. ${variable.example}` : "valor"}
                </label>
                <input
                  value={values[i] ?? ""}
                  onChange={(e) => setValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                  placeholder={variable.example ?? `Valor para {{${variable.index}}}`}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
                />
              </div>
            ))}
            <div className="rounded-md bg-muted/60 p-2 text-sm">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">Vista previa</p>
              <p className="whitespace-pre-wrap break-words">
                <LinkedText text={preview} />
              </p>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay plantillas aprobadas. Créalas o sincronízalas en “Mensajes rápidos”.
          </p>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 focus-within:border-brand-navy focus-within:ring-2 focus-within:ring-brand-navy/30">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar plantilla"
                aria-label="Buscar plantilla"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            {sections.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">Ninguna plantilla coincide con «{query.trim()}».</p>
            ) : (
              sections.map((section) => (
                <section key={section.key} aria-label={section.title} className="space-y-1">
                  <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</h3>
                  <ul className={grid ? "grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2" : "space-y-1"}>
                    {section.items.map((t) => {
                      const title = templateTitle(t.name);
                      return (
                        <li key={t.id} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => select(t)}
                            className={`w-full min-w-0 rounded-md border px-3 py-2 text-left text-sm hover:border-brand-navy hover:bg-brand-navy/5 ${grid ? "flex h-full flex-col" : ""}`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{title}</span>
                              <span className="shrink-0 rounded-full bg-brand-navy/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-navy dark:text-sky-300">{t.language}</span>
                            </span>
                            {title !== t.name && <span className="block truncate text-[10px] text-muted-foreground">{t.name}</span>}
                            {t.bodyText && (
                              <span className={`mt-0.5 block text-xs text-muted-foreground ${grid ? "line-clamp-4 break-words whitespace-pre-line" : "truncate"}`}>
                                <BodyWithTokens text={templateSnippet(t.name, t.bodyText)} />
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </div>

      {/* Pie fijo: el botón final siempre se ve, aunque la plantilla sea larga. */}
      {selected && (
        <div className="flex shrink-0 justify-end border-t px-3 py-2">
          <button
            type="button"
            onClick={() => onSubmit(selected.id, values.map((v) => v.trim()), preview)}
            disabled={!ready || busy}
            className="rounded-md bg-brand-navy px-4 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
