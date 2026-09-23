"use client";

// Panel "Detalle del contacto" (B2): el MISMO componente a la derecha de la
// Bandeja y en el pop-up de la tarjeta del Embudo. Orden acordado: nombre,
// teléfono, (etapa y temperatura), ¿inundaciones?, ¿cuánta agua?, ¿cuántas
// entradas?, ancho y tamaño por entrada, monto, % de convencimiento, [interruptor
// del bot → Fase B], comentarios y, al final compactos, correo y etiquetas.
// Guardado automático al salir de cada campo (sin botón Guardar), con aviso
// sutil. Etapa y temperatura las maneja el padre (cada vista las sincroniza a su
// modo: el tablero con su estado optimista, la Bandeja con el suyo).
import { useCallback, useEffect, useState } from "react";
import { getContactDetails, setNumEntradas, updateContactQualification } from "@/lib/actions/contact-qualification";
import { displayPhone } from "@/lib/phone-format";
import {
  STAGES,
  STAGE_LABELS,
  TEMPERATURES,
  TEMPERATURE_EMOJI,
  TEMPERATURE_LABELS,
  type Stage,
  type Temperature,
} from "../_data/types";
import { ContactComments } from "./contact-comments";
import { ContactEntradas, type Entrada } from "./contact-entradas";
import { useSaveStatus } from "./use-save-status";

type Details = Awaited<ReturnType<typeof getContactDetails>>;
type Inundaciones = NonNullable<Details["tieneInundaciones"]>;

const INUNDACIONES: { value: Inundaciones; label: string }[] = [
  { value: "si", label: "Sí" },
  { value: "no", label: "No" },
  { value: "no_sabe", label: "No sabe" },
];

const input =
  "w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";
const label = "text-xs text-muted-foreground";

const money = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className={label}>{title}</p>
      {children}
    </div>
  );
}

/**
 * Texto de un input numérico → número o null. undefined = inválido. Solo el
 * monto acepta "$" y comas de miles ("12,500.50"); en los enteros una coma es
 * inválida (así "2,5" no se vuelve 25).
 */
function parseNumber(text: string, { integer, min, max }: { integer: boolean; min: number; max: number }): number | null | undefined {
  const clean = integer ? text.trim() : text.replace(/[$,\s]/g, "");
  if (clean === "") return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < min || value > max) return undefined;
  if (integer && !Number.isInteger(value)) return undefined;
  return integer ? value : Math.round(value * 100) / 100;
}

export function ContactDetails({
  contactId,
  name,
  phone,
  stage,
  temperature,
  onStageChange,
  onTemperatureChange,
  busy = false,
  error,
  action,
}: {
  contactId: string;
  name: string;
  phone: string | null;
  stage: Stage;
  temperature: Temperature | null;
  onStageChange: (next: Stage) => void;
  onTemperatureChange: (next: Temperature | null) => void;
  busy?: boolean;
  error?: string | null;
  /** Botón extra en el encabezado (p. ej. "Cerrar" en el pop-up del Embudo). */
  action?: React.ReactNode;
}) {
  const { status, run } = useSaveStatus();
  const [details, setDetails] = useState<Details | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Borradores de los campos de texto (se guardan al salir del campo).
  const [nivelCm, setNivelCm] = useState("");
  const [nivelTexto, setNivelTexto] = useState("");
  const [numEntradas, setNumEntradasDraft] = useState("");
  const [monto, setMonto] = useState("");

  const applyDetails = useCallback((next: Details) => {
    setDetails(next);
    setNivelCm(next.nivelAguaCm === null ? "" : String(next.nivelAguaCm));
    setNivelTexto(next.nivelAguaTexto ?? "");
    setNumEntradasDraft(next.numEntradas === null ? "" : String(next.numEntradas));
    setMonto(next.montoCotizacion === null ? "" : money.format(next.montoCotizacion));
  }, []);

  const reload = useCallback(async () => {
    try {
      applyDetails(await getContactDetails(contactId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [applyDetails, contactId]);

  // Recargas PARCIALES (tras cambiar las entradas o los comentarios): solo esa
  // parte, sin pisar lo que el vendedor esté tecleando en otros campos.
  async function refreshEntradas() {
    const fresh = await getContactDetails(contactId);
    setDetails((d) => (d ? { ...d, numEntradas: fresh.numEntradas, entradas: fresh.entradas } : d));
    setNumEntradasDraft(fresh.numEntradas === null ? "" : String(fresh.numEntradas));
  }
  async function refreshComments() {
    const fresh = await getContactDetails(contactId);
    setDetails((d) => (d ? { ...d, comentarios: fresh.comentarios } : d));
  }

  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  // Guarda un parche de la calificación y refleja lo que devolvió el servidor.
  async function savePatch(patch: Parameters<typeof updateContactQualification>[1]): Promise<boolean> {
    return run(async () => {
      await updateContactQualification(contactId, patch);
      setDetails((d) => (d ? { ...d, ...patch } : d));
    });
  }

  function onNumberBlur(
    text: string,
    current: number | null,
    opts: { integer: boolean; min: number; max: number },
    field: "nivelAguaCm" | "montoCotizacion",
    reset: () => void,
    message: string,
  ) {
    const value = parseNumber(text, opts);
    if (value === undefined) {
      reset();
      void run(() => Promise.reject(new Error(field)), message);
      return;
    }
    if (value !== current) {
      // Si falla, el campo vuelve al último valor guardado (no queda mostrando
      // algo que no se guardó).
      void savePatch(field === "nivelAguaCm" ? { nivelAguaCm: value } : { montoCotizacion: value }).then((ok) => {
        if (!ok) reset();
      });
      // El monto se muestra con formato (12,500.50) en cuanto se guarda.
      if (field === "montoCotizacion") setMonto(value === null ? "" : money.format(value));
    } else reset();
  }

  if (loadError) {
    return <p className="p-4 text-sm text-brand-orange">No se pudo cargar el detalle del contacto.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Detalle del contacto</h2>
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="text-[11px] text-muted-foreground">
            {status.state === "saving" ? "Guardando…" : status.state === "saved" ? "Guardado ✓" : ""}
          </span>
          {action}
        </div>
      </div>
      {/* Errores fuera de la zona con scroll: se ven aunque el vendedor esté
          abajo (en los comentarios). */}
      {(status.state === "error" || error) && (
        <p role="alert" className="border-b bg-brand-orange/10 px-4 py-1.5 text-xs text-brand-orange">
          {status.state === "error" ? status.message : error}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">

        <div>
          <p className="font-medium break-words">{name}</p>
          <p className="text-xs text-muted-foreground">{displayPhone(phone) || "Sin teléfono"}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className={label}>Etapa</span>
            <select value={stage} disabled={busy} onChange={(e) => onStageChange(e.target.value as Stage)} className={`${input} disabled:opacity-60`}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={label}>Temperatura</span>
            <select
              value={temperature ?? ""}
              disabled={busy}
              onChange={(e) => onTemperatureChange(e.target.value === "" ? null : (e.target.value as Temperature))}
              className={`${input} disabled:opacity-60`}
            >
              <option value="">Sin asignar</option>
              {TEMPERATURES.map((t) => (
                <option key={t} value={t}>
                  {TEMPERATURE_EMOJI[t]} {TEMPERATURE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {details === null ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : (
          <>
            <Field title="¿Tiene problemas de inundaciones?">
              <div role="radiogroup" aria-label="¿Tiene problemas de inundaciones?" className="flex gap-1">
                {INUNDACIONES.map((o) => {
                  const selected = details.tieneInundaciones === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => void savePatch({ tieneInundaciones: selected ? null : o.value })}
                      className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                        selected ? "border-brand-navy bg-brand-navy text-brand-white" : "hover:bg-muted"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field title="¿Cuánta agua entra?">
              <div className="flex gap-2">
                <div className="relative w-24 shrink-0">
                  <input
                    aria-label="Nivel de agua (cm)"
                    inputMode="numeric"
                    value={nivelCm}
                    onChange={(e) => setNivelCm(e.target.value)}
                    onBlur={() =>
                      onNumberBlur(
                        nivelCm,
                        details.nivelAguaCm,
                        { integer: true, min: 0, max: 1000 },
                        "nivelAguaCm",
                        () => setNivelCm(details.nivelAguaCm === null ? "" : String(details.nivelAguaCm)),
                        "El nivel debe ser un entero de 0 a 1000 cm.",
                      )
                    }
                    className={`${input} pr-8`}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">cm</span>
                </div>
                <input
                  aria-label="Descripción del nivel de agua"
                  placeholder="Descripción (opcional)"
                  value={nivelTexto}
                  maxLength={500}
                  onChange={(e) => setNivelTexto(e.target.value)}
                  onBlur={() => {
                    const next = nivelTexto.trim() || null;
                    if (next !== details.nivelAguaTexto) {
                      void savePatch({ nivelAguaTexto: next }).then((ok) => {
                        if (!ok) setNivelTexto(details.nivelAguaTexto ?? "");
                      });
                    }
                  }}
                  className={input}
                />
              </div>
            </Field>

            <Field title="¿Cuántas entradas?">
              <input
                aria-label="Número de entradas"
                inputMode="numeric"
                value={numEntradas}
                onChange={(e) => setNumEntradasDraft(e.target.value)}
                onBlur={() => {
                  const value = parseNumber(numEntradas, { integer: true, min: 0, max: 50 });
                  if (value === undefined) {
                    setNumEntradasDraft(details.numEntradas === null ? "" : String(details.numEntradas));
                    void run(() => Promise.reject(new Error("entradas")), "Las entradas deben ser un entero de 0 a 50.");
                    return;
                  }
                  if (value === details.numEntradas) return;
                  // Vaciar el campo equivale a 0: si ya había entradas, también
                  // borra sus anchos y pide confirmación.
                  const target = value ?? 0;
                  const existing = details.entradas.length;
                  if (target < existing) {
                    const which = target === 0 ? "todas las entradas" : `las entradas ${target + 1} a ${existing}`;
                    if (!window.confirm(`Se borrarán los anchos de ${which}. ¿Continuar?`)) {
                      setNumEntradasDraft(details.numEntradas === null ? "" : String(details.numEntradas));
                      return;
                    }
                  }
                  void run(async () => {
                    await setNumEntradas(contactId, value);
                    await refreshEntradas();
                  });
                }}
                className={`${input} w-24`}
              />
            </Field>

            {details.entradas.length > 0 && (
              <Field title="Ancho de cada entrada y tamaño de compuerta sugerido">
                <ContactEntradas
                  contactId={contactId}
                  entradas={details.entradas as Entrada[]}
                  run={run}
                  onSaved={(next) =>
                    setDetails((d) => (d ? { ...d, entradas: d.entradas.map((e) => (e.posicion === next.posicion ? next : e)) } : d))
                  }
                />
              </Field>
            )}

            <Field title="Monto de cotización (MXN)">
              <div className="relative w-40">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <input
                  aria-label="Monto de cotización en MXN"
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  onBlur={() =>
                    onNumberBlur(
                      monto,
                      details.montoCotizacion,
                      { integer: false, min: 0, max: 9_999_999_999.99 },
                      "montoCotizacion",
                      () => setMonto(details.montoCotizacion === null ? "" : money.format(details.montoCotizacion)),
                      "El monto debe ser un número positivo.",
                    )
                  }
                  className={`${input} pl-5`}
                />
              </div>
            </Field>

            <Field title="% de convencimiento">
              <select
                aria-label="Porcentaje de convencimiento"
                value={details.porcentajeConvencimiento ?? ""}
                onChange={(e) => void savePatch({ porcentajeConvencimiento: e.target.value === "" ? null : Number(e.target.value) })}
                className={`${input} w-28`}
              >
                <option value="">—</option>
                {Array.from({ length: 11 }, (_, i) => i * 10).map((p) => (
                  <option key={p} value={p}>
                    {p}%
                  </option>
                ))}
              </select>
            </Field>

            {/* Espacio reservado: interruptor del Agente IA en esta conversación (Fase B). */}
            <div data-slot="interruptor-agente-ia" />

            <Field title="Comentarios">
              <ContactComments contactId={contactId} comments={details.comentarios} viewer={details.viewer} run={run} onChanged={refreshComments} />
            </Field>

            <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
              <p className="truncate">
                <span className="mr-1">Correo:</span>
                <span className="text-foreground">{details.email || "—"}</span>
              </p>
              {details.tags.length > 0 && (
                <p className="flex flex-wrap gap-1">
                  {details.tags.map((t) => (
                    <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                      {t}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
