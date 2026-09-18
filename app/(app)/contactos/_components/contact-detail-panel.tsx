"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  STAGES,
  STAGE_LABELS,
  TEMPERATURES,
  TEMPERATURE_EMOJI,
  TEMPERATURE_LABELS,
  getContactFullName,
  type Contact,
  type Stage,
  type Temperature,
} from "../_data/types";

// tags y notas todavía no tienen columnas propias en la BD: se leen de
// custom_fields (jsonb) si vienen del import de GHL, sólo para mostrar. La
// edición real llega cuando tengan almacenamiento propio.
function readTags(contact: Contact): string[] {
  const raw = (contact.customFields as Record<string, unknown> | null)?.tags;
  if (Array.isArray(raw)) {
    return raw.filter((tag): tag is string => typeof tag === "string");
  }
  return [];
}

function readNotes(contact: Contact): string {
  const raw = (contact.customFields as Record<string, unknown> | null)?.notas;
  return typeof raw === "string" ? raw : "";
}

function Attribute({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}

export function ContactDetailPanel({
  contact,
  isSaving,
  onClose,
  onStageChange,
  onTemperatureChange,
}: {
  contact: Contact;
  isSaving: boolean;
  onClose: () => void;
  onStageChange: (stage: Stage) => void;
  onTemperatureChange: (temperature: Temperature | null) => void;
}) {
  const tags = readTags(contact);
  const notes = readNotes(contact);
  const canal = contact.sourceChannel ?? contact.source ?? "—";

  // a11y del modal: cerrar con Escape, enfocar el panel al abrir y devolver el
  // foco al elemento disparador al cerrar. (Trap de foco completo queda como
  // mejora futura; esto cubre lo esencial para uso con teclado.)
  const panelRef = useRef<HTMLDivElement>(null);

  // Cierre con animacion de salida: se marca "cerrando" para reproducir el
  // fade/zoom-out y, al terminar (~180ms), se avisa al padre que desmonte.
  const [isClosing, setIsClosing] = useState(false);
  const requestClose = () => setIsClosing(true);

  useEffect(() => {
    if (!isClosing) {
      return;
    }
    const timer = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(timer);
  }, [isClosing, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsClosing(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar detalle del contacto"
        onClick={requestClose}
        className={`absolute inset-0 bg-black/40 duration-200 motion-reduce:animate-none ${
          isClosing ? "animate-out fade-out-0" : "animate-in fade-in-0"
        }`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-detail-title"
        tabIndex={-1}
        className={`relative flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-background shadow-xl outline-none duration-200 ease-out motion-reduce:animate-none md:flex-row ${
          isClosing ? "animate-out fade-out-0 zoom-out-95" : "animate-in fade-in-0 zoom-in-95"
        }`}
      >
        {/* Panel izquierdo: conversación (placeholder hasta conectar WhatsApp) */}
        <section className="flex min-h-0 flex-1 flex-col border-b md:border-b-0 md:border-r">
          <header className="flex items-center justify-between gap-2 bg-brand-navy px-4 py-3 text-brand-white">
            <div className="min-w-0">
              <p id="contact-detail-title" className="truncate font-semibold">{getContactFullName(contact)}</p>
              <p className="truncate text-xs text-white/70">{canal}</p>
            </div>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="text-3xl" role="img" aria-label="Chat">💬</span>
            <p className="text-sm font-medium">Aún no hay conversación</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              El historial de mensajes con este contacto aparecerá aquí cuando se
              conecte WhatsApp.
            </p>
          </div>

          {/* Redactor deshabilitado: anticipa el chat real, sin funcionalidad. */}
          <div className="flex items-center gap-2 border-t p-3">
            <input
              type="text"
              disabled
              placeholder="El envío de mensajes llegará con WhatsApp…"
              className="flex-1 rounded border bg-muted/40 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled
              className="rounded bg-brand-orange px-3 py-2 text-sm text-brand-white opacity-50"
            >
              Enviar
            </button>
          </div>
        </section>

        {/* Panel derecho: atributos del contacto */}
        <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto p-5 md:w-80">
          <div className="flex items-start justify-between">
            <h2 className="text-sm font-semibold">Detalle del contacto</h2>
            <button
              type="button"
              onClick={requestClose}
              className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
            >
              Cerrar
            </button>
          </div>

          <dl className="space-y-3 text-sm">
            <Attribute label="Nombre" value={getContactFullName(contact)} />
            <Attribute label="Teléfono" value={contact.phoneE164 ?? "—"} />
            <Attribute label="Correo" value={contact.email ?? "—"} />
            <Attribute label="Canal" value={canal} />
            <Attribute
              label="Etiquetas"
              value={
                tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {tag}
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Attribute label="Notas" value={notes || "—"} />
          </dl>

          <div className="space-y-1">
            <label htmlFor="contact-stage" className="text-xs text-muted-foreground">
              Etapa
            </label>
            <select
              id="contact-stage"
              value={contact.stage}
              disabled={isSaving}
              onChange={(event) => onStageChange(event.target.value as Stage)}
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-60"
            >
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="contact-temperature" className="text-xs text-muted-foreground">
              Temperatura
            </label>
            <select
              id="contact-temperature"
              value={contact.temperature ?? ""}
              disabled={isSaving}
              onChange={(event) =>
                onTemperatureChange(event.target.value === "" ? null : (event.target.value as Temperature))
              }
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">Sin asignar</option>
              {TEMPERATURES.map((temperature) => (
                <option key={temperature} value={temperature}>
                  {TEMPERATURE_EMOJI[temperature]} {TEMPERATURE_LABELS[temperature]}
                </option>
              ))}
            </select>
          </div>
        </aside>
      </div>
    </div>
  );
}
