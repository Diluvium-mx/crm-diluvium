"use client";

// Panel "Detalle del contacto" (B2): el MISMO componente a la derecha de la
// Bandeja y en el pop-up de la tarjeta del Embudo. Orden acordado: nombre,
// teléfono, (etapa y temperatura), ¿inundaciones?, ¿cuánta agua?, ¿cuántas
// entradas?, ancho y tamaño por entrada, monto, % de convencimiento, [interruptor
// del bot → Fase B], comentarios y, al final compactos, correo y etiquetas.
// Guardado automático al salir de cada campo (sin botón Guardar), con aviso
// sutil. Etapa y temperatura las maneja el padre (cada vista las sincroniza a su
// modo: el tablero con su estado optimista, la Bandeja con el suyo).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getContactDetails, setNumEntradas, updateContactQualification } from "@/lib/actions/contact-qualification";
import { createSerialSaves } from "@/lib/autosave/serial-saves";
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
import { ConvencimientoPicker } from "./convencimiento-picker";
import { useSaveStatus } from "./use-save-status";
import { AgentContactSwitch } from "./agent-contact-switch";

type Details = Awaited<ReturnType<typeof getContactDetails>>;
type Inundaciones = NonNullable<Details["tieneInundaciones"]>;
type QualField = "tieneInundaciones" | "nivelAguaCm" | "nivelAguaTexto" | "montoCotizacion" | "porcentajeConvencimiento";
type Qualification = Pick<Details, QualField>;

function qualificationOf(d: Details): Qualification {
  return {
    tieneInundaciones: d.tieneInundaciones,
    nivelAguaCm: d.nivelAguaCm,
    nivelAguaTexto: d.nivelAguaTexto,
    montoCotizacion: d.montoCotizacion,
    porcentajeConvencimiento: d.porcentajeConvencimiento,
  };
}

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
  // Hallazgo 4: los guardados de cada campo salen en serie y solo la respuesta
  // del último pedido se muestra (lib/autosave/serial-saves.ts). `details`
  // muestra lo último PEDIDO; `confirmed`, lo último que el servidor guardó: a
  // eso vuelve un campo si su último guardado falla.
  const [saves] = useState(createSerialSaves);
  const confirmed = useRef<Qualification | null>(null);
  const confirmedNum = useRef<number | null>(null);

  const applyDetails = useCallback((next: Details) => {
    confirmed.current = qualificationOf(next);
    confirmedNum.current = next.numEntradas;
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
  // parte, sin pisar lo que el vendedor esté tecleando en otros campos. Cada una
  // en su carril: una relectura vieja no pisa a una más nueva.
  //
  // "¿Cuántas entradas?": cada pedido (guardar o solo releer) termina releyendo
  // lo que quedó en el servidor, y solo se muestra la respuesta del último. Va
  // en el carril "entradas", el mismo de los guardados de cada fila. Las
  // escrituras nunca se descartan sin salir (bajar el número borra filas: 7 → 2
  // → 6 no es lo mismo que 7 → 6). Si el último guardado falla, el número vuelve
  // a lo último confirmado (así se puede reintentar el mismo valor) y, si hay
  // red, se relee lo que el servidor sí tiene.
  async function syncEntradas(write?: () => Promise<unknown>): Promise<void> {
    const outcome = await saves.save(
      "numEntradas",
      async () => {
        await write?.();
        return getContactDetails(contactId);
      },
      { lane: "entradas", droppable: !write },
    );
    if (outcome.status === "saved") confirmedNum.current = outcome.result.numEntradas;
    if (outcome.status === "superseded" || !outcome.latest) return;
    if (outcome.status === "saved") {
      const fresh = outcome.result;
      setDetails((d) => (d ? { ...d, numEntradas: fresh.numEntradas, entradas: fresh.entradas } : d));
      setNumEntradasDraft(fresh.numEntradas === null ? "" : String(fresh.numEntradas));
      return;
    }
    const saved = confirmedNum.current;
    setDetails((d) => (d ? { ...d, numEntradas: saved } : d));
    setNumEntradasDraft(saved === null ? "" : String(saved));
    if (write) await syncEntradas().catch(() => undefined);
    throw outcome.error;
  }
  async function refreshComments() {
    const outcome = await saves.save("comentarios", () => getContactDetails(contactId));
    if (outcome.status === "superseded" || !outcome.latest) return;
    if (outcome.status === "failed") throw outcome.error;
    const fresh = outcome.result;
    setDetails((d) => (d ? { ...d, comentarios: fresh.comentarios } : d));
  }

  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  // Guarda UN campo de la calificación. El valor se muestra al instante; si su
  // último guardado falla, el campo (y su borrador, vía `show`) vuelve a lo
  // último que el servidor guardó, no a lo que había cuando se pidió.
  function saveField<K extends QualField>(field: K, value: Qualification[K], show?: (saved: Qualification[K]) => void) {
    setDetails((d) => (d ? { ...d, [field]: value } : d));
    void run(async () => {
      const patch = { [field]: value } as Pick<Qualification, K>;
      const outcome = await saves.save(field, () => updateContactQualification(contactId, patch));
      if (outcome.status === "saved" && confirmed.current) confirmed.current = { ...confirmed.current, ...patch };
      if (outcome.status !== "failed" || !outcome.latest) return;
      if (confirmed.current) {
        const saved = confirmed.current[field];
        setDetails((d) => (d ? { ...d, [field]: saved } : d));
        show?.(saved);
      }
      throw outcome.error;
    });
  }

  function onNumberBlur(
    text: string,
    current: number | null,
    opts: { integer: boolean; min: number; max: number },
    field: "nivelAguaCm" | "montoCotizacion",
    show: (value: number | null) => void,
    message: string,
  ) {
    const value = parseNumber(text, opts);
    if (value === undefined) {
      show(current);
      void run(() => Promise.reject(new Error(field)), message);
      return;
    }
    // El monto se muestra con formato (12,500.50) en cuanto se pide guardarlo.
    show(value);
    if (value !== current) saveField(field, value, show);
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
                      onClick={() => saveField("tieneInundaciones", selected ? null : o.value)}
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
                        (v) => setNivelCm(v === null ? "" : String(v)),
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
                    if (next !== details.nivelAguaTexto) saveField("nivelAguaTexto", next, (saved) => setNivelTexto(saved ?? ""));
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
                  setDetails((d) => (d ? { ...d, numEntradas: value } : d));
                  void run(() => syncEntradas(() => setNumEntradas(contactId, value)));
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
                  saves={saves}
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
                      (v) => setMonto(v === null ? "" : money.format(v)),
                      "El monto debe ser un número positivo.",
                    )
                  }
                  className={`${input} pl-5`}
                />
              </div>
            </Field>

            <Field title="% de convencimiento">
              <ConvencimientoPicker
                value={details.porcentajeConvencimiento}
                onChange={(next) => saveField("porcentajeConvencimiento", next)}
                selectClassName={input}
              />
            </Field>

            {(details.anuncios || details.anuncio) && (
              <Field title="Llegó por anuncio">
                {details.anuncios && (
                  <Link href={details.anuncios.first.href} className="block truncate text-xs font-medium text-brand-navy hover:underline dark:text-brand-white">
                    📣 {details.anuncios.first.name}
                  </Link>
                )}
                {details.anuncio && <p className="text-xs text-muted-foreground">{details.anuncio}</p>}
                {details.anuncios && details.anuncios.others.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    También volvió por:{" "}
                    {details.anuncios.others.map((o, i) => (
                      <span key={o.href}>
                        {i > 0 && ", "}
                        <Link href={o.href} className="text-brand-navy hover:underline dark:text-brand-white">
                          {o.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </Field>
            )}

            {/* Estado del Agente IA en esta conversación (Fase B). */}
            <AgentContactSwitch contactId={contactId} />

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
