"use client";

// Formulario para programar (o editar) un mensaje (A6). Fecha y hora en hora
// de Mazatlán. Si a esa hora la ventana de 24 h ya estará cerrada, solo deja
// elegir PLANTILLA (el servidor lo vuelve a validar al programar y al enviar).
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { scheduleMessage, updateScheduledMessage } from "@/lib/actions/scheduled";
import { instantToLocal, localToInstant, textAllowedAt } from "@/lib/scheduled/rules";
import type { ScheduledView } from "@/lib/scheduled/types";
import { TemplatePicker } from "./template-picker";

type Mode = { type: "new"; initialText: string; templateOnly: boolean } | { type: "edit"; item: ScheduledView };

// Propuesta inicial: dentro de 1 h, redondeado a los siguientes 5 minutos.
function defaultWhen(): string {
  const step = 5 * 60_000;
  return instantToLocal(new Date(Math.ceil((Date.now() + 60 * 60_000) / step) * step));
}

export function ScheduleForm({
  mode,
  conversationId,
  windowExpiresAt,
  onDone,
  onCancel,
}: {
  mode: Mode;
  conversationId: string;
  windowExpiresAt: Date | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = mode.type === "edit" ? mode.item : null;
  const [when, setWhen] = useState(() => (editing ? instantToLocal(new Date(editing.sendAt)) : defaultWhen()));
  // Mínimo del selector, fijado al abrir el formulario (el servidor valida la hora real).
  const [minWhen] = useState(() => instantToLocal(new Date(Date.now() + 60_000)));
  const [cancelIfInbound, setCancelIfInbound] = useState(editing ? editing.cancelIfInbound : true);
  const [text, setText] = useState(editing ? editing.body : mode.type === "new" ? mode.initialText : "");
  const [kind, setKind] = useState<"text" | "template">(
    editing ? editing.kind : mode.type === "new" && mode.templateOnly ? "template" : "text",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Candado síncrono contra el doble clic (el estado `saving` llega un render tarde).
  const inFlight = useRef(false);

  const sendAt = localToInstant(when);
  const textOk = sendAt ? textAllowedAt(windowExpiresAt, sendAt) : true;
  const canUseText = !(mode.type === "new" && mode.templateOnly);

  async function submit(action: () => ReturnType<typeof scheduleMessage>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await action();
      if (result.ok) onDone();
      else setError(result.message);
    } catch {
      setError("No se pudo programar. Intenta de nuevo.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function submitText() {
    if (editing) {
      void submit(() =>
        updateScheduledMessage(editing.id, {
          sendAtLocal: when,
          cancelIfInbound,
          text: editing.kind === "text" ? text : undefined,
        }),
      );
      return;
    }
    void submit(() => scheduleMessage({ conversationId, kind: "text", text, sendAtLocal: when, cancelIfInbound }));
  }

  return (
    <div className="mb-2 rounded-lg border bg-background p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">🕒 {editing ? "Editar mensaje programado" : "Programar mensaje"}</span>
        <button type="button" onClick={onCancel} aria-label="Cerrar" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Fecha y hora (Mazatlán)</span>
          <input
            type="datetime-local"
            value={when}
            min={minWhen}
            onChange={(event) => setWhen(event.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" checked={cancelIfInbound} onChange={(event) => setCancelIfInbound(event.target.checked)} />
          <span>Cancelar si el cliente escribe antes</span>
        </label>
        {!editing && canUseText && (
          <div role="radiogroup" aria-label="Tipo de mensaje" className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
            {(["text", "template"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-md px-2 py-1 ${kind === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
              >
                {k === "text" ? "Texto" : "📄 Plantilla"}
              </button>
            ))}
          </div>
        )}
      </div>

      {kind === "text" ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="Mensaje a enviar"
            className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
          />
          {!textOk && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              A esa hora la ventana de 24 h ya estará cerrada: elige una plantilla o una hora más cercana.
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitText}
              disabled={saving || !sendAt || !text.trim() || !textOk}
              className="rounded-md bg-brand-navy px-4 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
            >
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Programar"}
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="mt-2 space-y-2">
          <p className="rounded-md bg-muted/60 p-2 text-sm whitespace-pre-wrap">{text}</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitText}
              disabled={saving || !sendAt}
              className="rounded-md bg-brand-navy px-4 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <TemplatePicker
            submitLabel={saving ? "Guardando…" : "Programar plantilla"}
            busy={saving}
            onSubmit={(templateId, values) =>
              void submit(() =>
                scheduleMessage({
                  conversationId,
                  kind: "template",
                  templateId,
                  templateParams: values,
                  sendAtLocal: when,
                  cancelIfInbound,
                }),
              )
            }
            onClose={onCancel}
          />
        </div>
      )}

      {error && <p className="mt-2 text-xs text-brand-orange">{error}</p>}
    </div>
  );
}
