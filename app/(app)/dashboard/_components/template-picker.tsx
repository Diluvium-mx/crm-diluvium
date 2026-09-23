"use client";

// Selector de plantillas para el composer cuando la ventana de 24 h está
// CERRADA (solo se pueden mandar plantillas aprobadas por Meta). Carga las
// aprobadas, deja rellenar las variables posicionales y las manda al composer,
// que hace el envío optimista (igual que el texto).
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { listTemplates } from "@/lib/actions/templates";
import { renderTemplateBody } from "@/lib/messaging/template-format";
import type { TemplateView } from "@/lib/templates/types";

const TOKEN_CLASS = "rounded bg-brand-navy/15 px-1 font-medium text-brand-navy";

export function TemplatePicker({
  onSubmit,
  onClose,
  submitLabel = "Enviar plantilla",
  busy = false,
}: {
  onSubmit: (templateId: string, values: string[], preview: string) => void;
  onClose: () => void;
  /** Texto del botón final (p. ej. "Programar plantilla" en A6). */
  submitLabel?: string;
  /** Hay un envío en curso: el botón final queda deshabilitado (sin doble envío). */
  busy?: boolean;
}) {
  const [templates, setTemplates] = useState<TemplateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<string[]>([]);

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
    setValues(template.variables.map(() => ""));
  }

  const preview = selected?.bodyText ? renderTemplateBody(selected.bodyText, values) : selected?.bodyText ?? "";
  const ready = selected !== null && values.length === (selected?.variables.length ?? 0) && values.every((v) => v.trim().length > 0);

  return (
    <div className="mb-2 rounded-lg border bg-background shadow-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
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
          <span className="text-sm font-semibold text-brand-navy">📄 {selected ? selected.name : "Elegir plantilla"}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-3">
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
              <p className="whitespace-pre-wrap break-words">{preview}</p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => selected && onSubmit(selected.id, values.map((v) => v.trim()), preview)}
                disabled={!ready || busy}
                className="rounded-md bg-brand-navy px-4 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
              >
                {submitLabel}
              </button>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay plantillas aprobadas. Sincronízalas en “Mensajes rápidos”.
          </p>
        ) : (
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => select(t)}
                  className="w-full rounded-md border px-3 py-2 text-left text-sm hover:border-brand-navy hover:bg-brand-navy/5"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="rounded-full bg-brand-navy/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-navy">{t.language}</span>
                  </span>
                  {t.bodyText && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t.bodyText}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
