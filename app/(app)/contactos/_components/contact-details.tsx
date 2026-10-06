"use client";

// Panel "Detalle del contacto" (B2): el MISMO componente a la derecha de la
// Bandeja y en el pop-up de la tarjeta del Embudo. Orden acordado: nombre,
// teléfono, (etapa y temperatura), ¿inundaciones?, ¿cuánta agua?, ¿cuántas
// entradas?, ancho y tamaño por entrada, monto y pago, % de convencimiento, [interruptor
// del bot → Fase B] y, al final compactos, correo y etiquetas (sin Comentarios desde el 6-oct-2026).
// Guardado automático al salir de cada campo (sin botón Guardar), con aviso
// sutil. Etapa y temperatura las maneja el padre (cada vista las sincroniza a su
// modo: el tablero con su estado optimista, la Bandeja con el suyo).
// En vivo (contact.updated del SSE): lo que cambie otro (Agente IA —incluido el
// autollenado—, automatización u otro vendedor) aparece solo, sin pisar un campo
// que el vendedor esté escribiendo ni uno con su guardado en curso.
// Agente IA parte 1 (26-sep-2026): marca "IA" en todo lo que el agente escribió al
// último (etapa, inundaciones, agua, entradas, monto y %); el campo que acaba de llenar
// se ilumina con el orbe "actualizando"; el % de convencimiento es solo del agente
// (sin selector) y el control del agente (Pausar agente / Activar) vive aquí.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getContactDetails, setNumEntradas, updateContactQualification } from "@/lib/actions/contact-qualification";
import { createSerialSaves } from "@/lib/autosave/serial-saves";
import { trackSaves } from "@/lib/autosave/tracked-saves";
import { useInboxStream } from "../../dashboard/_components/use-inbox-stream";
import { contactHandle } from "@/lib/phone-format";
import { useFunnelStages } from "../../_components/funnel-stages-provider";
import {
  TEMPERATURES,
  TEMPERATURE_EMOJI,
  TEMPERATURE_LABELS,
  type Stage,
  type Temperature,
} from "../_data/types";
import { ContactEntradas, type Entrada } from "./contact-entradas";
import { ConvencimientoBar } from "./convencimiento-picker";
import { useSaveStatus } from "./use-save-status";
import { AgentContactSwitch } from "./agent-contact-switch";
import { IaMark } from "./ia-mark";
import { TemperatureDestacadoMenu } from "./temperature-destacado-menu";
import { LectorStatusLine } from "./lector-status";

type Details = Awaited<ReturnType<typeof getContactDetails>>;
type Inundaciones = NonNullable<Details["tieneInundaciones"]>;
type QualField = "tieneInundaciones" | "nivelAguaCm" | "nivelAguaTexto" | "montoCotizacion" | "pagoTotal" | "porcentajeConvencimiento";
type Qualification = Pick<Details, QualField>;

const QUAL_FIELDS: readonly QualField[] = [
  "tieneInundaciones",
  "nivelAguaCm",
  "nivelAguaTexto",
  "montoCotizacion",
  "pagoTotal",
  "porcentajeConvencimiento",
];

function copyField<K extends QualField>(target: Qualification, source: Qualification, field: K): void {
  target[field] = source[field];
}

function qualificationOf(d: Details): Qualification {
  return {
    tieneInundaciones: d.tieneInundaciones,
    nivelAguaCm: d.nivelAguaCm,
    nivelAguaTexto: d.nivelAguaTexto,
    montoCotizacion: d.montoCotizacion,
    pagoTotal: d.pagoTotal,
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

// Un campo del Detalle: título a la izquierda y, a la derecha, la marca "IA" (si el
// agente lo escribió al último). `flash` = lo acaba de llenar: se ilumina (globals.css).
function Field({
  title,
  children,
  ia = false,
  flash = false,
}: {
  title: string;
  children: React.ReactNode;
  ia?: boolean;
  flash?: boolean;
}) {
  return (
    <div data-ia-flash={flash ? "" : undefined} className="-mx-1.5 space-y-1 px-1.5 py-1">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <p className={label}>{title}</p>
        {ia && <IaMark active={flash} />}
      </div>
      {children}
    </div>
  );
}

// Encabezado de sección (Calificación, Agente IA).
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

// Cuánto dura la animación del campo que el agente acaba de llenar (igual que en globals.css).
const FLASH_MS = 2_400;

// Campo de la calificación → su llave de origen (lib/contacts/qualification.ts).
const IA_KEY: Record<QualField, string> = {
  tieneInundaciones: "tiene_inundaciones",
  nivelAguaCm: "nivel_agua_cm",
  nivelAguaTexto: "nivel_agua_texto",
  montoCotizacion: "monto_cotizacion",
  pagoTotal: "pago_total",
  porcentajeConvencimiento: "porcentaje_convencimiento",
};

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
  instagramUsername,
  stage,
  temperature,
  destacado,
  onStageChange,
  onTemperatureChange,
  onDestacadoChange,
  busy = false,
  error,
  action,
  conversationId,
}: {
  contactId: string;
  /** La conversación abierta (Bandeja): el control del agente es el de ESTA. */
  conversationId?: string;
  name: string;
  phone: string | null;
  /** Cliente de Instagram (sin teléfono): su @usuario. */
  instagramUsername?: string | null;
  stage: Stage;
  temperature: Temperature | null;
  /**
   * Destacado ⭐ del contacto. Solo el pop-up del Embudo lo pasa (con onDestacadoChange):
   * ahí la sección Temperatura asigna las dos cosas. La Bandeja no: su estrella está en la lista.
   */
  destacado?: boolean;
  onStageChange: (next: Stage) => void;
  onTemperatureChange: (next: Temperature | null) => void;
  onDestacadoChange?: (next: boolean) => void;
  busy?: boolean;
  error?: string | null;
  /** Botón extra en el encabezado (p. ej. "Cerrar" en el pop-up del Embudo). */
  action?: React.ReactNode;
}) {
  const { status, run } = useSaveStatus();
  // Columnas del Embudo vigentes (nombre y orden en vivo).
  const { stages } = useFunnelStages();
  const [details, setDetails] = useState<Details | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Borradores de los campos de texto (se guardan al salir del campo).
  const [nivelCm, setNivelCm] = useState("");
  const [nivelTexto, setNivelTexto] = useState("");
  const [numEntradas, setNumEntradasDraft] = useState("");
  const [monto, setMonto] = useState("");
  const [pago, setPago] = useState("");
  // Hallazgo 4: los guardados de cada campo salen en serie y solo la respuesta
  // del último pedido se muestra (lib/autosave/serial-saves.ts). `details`
  // muestra lo último PEDIDO; `confirmed`, lo último que el servidor guardó: a
  // eso vuelve un campo si su último guardado falla.
  // Con la cuenta de lo que se está guardando por carril: el tiempo real no pisa
  // un campo con su guardado en curso (lib/autosave/tracked-saves.ts).
  const [tracker] = useState(() => trackSaves(createSerialSaves()));
  const saves = tracker.saves;
  const confirmed = useRef<Qualification | null>(null);
  const confirmedNum = useRef<number | null>(null);
  // Campos de texto que el vendedor está escribiendo (tecleó y aún no sale del
  // campo): el tiempo real no pisa su borrador; al salir, lo suyo se guarda.
  const typing = useRef(new Set<string>());
  const loaded = useRef(false);

  // Animación "el agente acaba de llenar esto" (por llave de campo; ver IA_KEY).
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  function flashKeys(keys: readonly string[]) {
    if (keys.length === 0) return;
    setFlash((prev) => new Set([...prev, ...keys]));
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(new Set()), FLASH_MS);
  }
  const lit = (...keys: string[]) => keys.some((k) => flash.has(k));
  const detailsRef = useRef<Details | null>(null);
  const etapaByAgent = useRef(false);
  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const applyDetails = useCallback((next: Details) => {
    loaded.current = true;
    confirmed.current = qualificationOf(next);
    confirmedNum.current = next.numEntradas;
    setDetails(next);
    setNivelCm(next.nivelAguaCm === null ? "" : String(next.nivelAguaCm));
    setNivelTexto(next.nivelAguaTexto ?? "");
    setNumEntradasDraft(next.numEntradas === null ? "" : String(next.numEntradas));
    setMonto(next.montoCotizacion === null ? "" : money.format(next.montoCotizacion));
    setPago(next.pagoTotal === null ? "" : money.format(next.pagoTotal));
  }, []);

  // Carga completa (al abrir). Si falla, se reintenta sola (5 s … 60 s) mientras
  // el panel siga abierto, y también al reconectar el SSE o al llegar un cambio de
  // este contacto: un fallo de red al abrirlo no deja el error pegado. Solo aplica
  // la respuesta del último pedido.
  const loadState = useRef<{ seq: number; failed: boolean; retryMs: number; timer?: ReturnType<typeof setTimeout> }>({
    seq: 0,
    failed: false,
    retryMs: 0,
  });
  useEffect(() => () => clearTimeout(loadState.current.timer), []);
  const reloadRef = useRef<() => Promise<void>>(async () => undefined);
  const reload = useCallback(async () => {
    const state = loadState.current;
    const seq = ++state.seq;
    clearTimeout(state.timer);
    state.timer = undefined;
    try {
      const next = await getContactDetails(contactId);
      if (seq !== state.seq) return;
      applyDetails(next);
      state.failed = false;
      state.retryMs = 0;
      setLoadError(false);
    } catch {
      if (seq !== state.seq) return;
      state.failed = true;
      setLoadError(true);
      state.retryMs = Math.min(state.retryMs ? state.retryMs * 2 : 5_000, 60_000);
      state.timer = setTimeout(() => void reloadRef.current(), state.retryMs);
    }
  }, [applyDetails, contactId]);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  // Recargas PARCIALES (tras cambiar las entradas): solo esa
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

  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  // Tiempo real: la cotización o los campos del Detalle de ESTE
  // contacto cambiaron (o el SSE se reconectó). Ventana fija de 500 ms: varios
  // cambios seguidos = una lectura. Las lecturas van en su carril: solo se aplica
  // la última. Se salta lo que el vendedor tiene en curso: un campo con guardado
  // pendiente (o que se guardó mientras la lectura iba en camino) y el borrador
  // que está tecleando. Lo saltado por un guardado se vuelve a leer en cuanto ese
  // guardado termina (si otro lo cambió en esa ventana, no se pierde). Si la
  // lectura falla, se reintenta sola (5 s … 60 s); un cambio nuevo la adelanta.
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const liveRetry = useRef({ ms: 0, pending: false });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(liveTimer.current);
    };
  }, []);
  function scheduleLive(delayMs = 500) {
    if (!alive.current) return;
    if (liveRetry.current.pending && delayMs === 500) {
      clearTimeout(liveTimer.current);
      liveTimer.current = undefined;
      liveRetry.current.pending = false;
    }
    if (liveTimer.current) return;
    liveTimer.current = setTimeout(() => {
      liveTimer.current = undefined;
      liveRetry.current.pending = false;
      void liveRefresh();
    }, delayMs);
  }
  useInboxStream((event) => {
    // Falló la carga al abrir: la reconexión o un cambio de este contacto la reintentan ya.
    if (loadState.current.failed) {
      if (event.type === "reload" || (event.type === "contact.updated" && event.contactId === contactId)) void reload();
      return;
    }
    if (event.type === "reload") {
      if (loaded.current) scheduleLive();
      return;
    }
    if (event.type !== "contact.updated" || event.contactId !== contactId) return;
    // La etapa también: su marca "IA" depende de quién la movió al último.
    if (event.changes.some((change) => change === "etapa" || change === "cotizacion" || change === "detalle")) scheduleLive();
    // El agente movió la etapa: se ilumina cuando llegue la lectura (con su marca "IA").
    if (event.by.kind === "agente" && event.changes.includes("etapa")) etapaByAgent.current = true;
  });

  async function liveRefresh() {
    const snap = tracker.snapshot();
    const outcome = await saves.save("live", () => getContactDetails(contactId));
    if (outcome.status === "failed" && outcome.latest) {
      liveRetry.current.ms = Math.min(liveRetry.current.ms ? liveRetry.current.ms * 2 : 5_000, 60_000);
      if (!liveTimer.current) {
        scheduleLive(liveRetry.current.ms);
        liveRetry.current.pending = true;
      }
      return;
    }
    if (outcome.status !== "saved" || !outcome.latest) return;
    liveRetry.current.ms = 0;
    const fresh = outcome.result;
    const busy = new Set([...QUAL_FIELDS, "entradas"].filter((lane) => tracker.touchedSince(lane, snap)));
    if (busy.size > 0) void tracker.whenIdle([...busy]).then(() => scheduleLive());
    const freshQ = qualificationOf(fresh);
    if (confirmed.current) {
      const next = { ...confirmed.current };
      for (const field of QUAL_FIELDS) if (!busy.has(field)) copyField(next, freshQ, field);
      confirmed.current = next;
    }
    if (!busy.has("entradas")) confirmedNum.current = fresh.numEntradas;
    // Lo que el agente acaba de cambiar (valor distinto y ahora con su marca): se ilumina.
    const prev = detailsRef.current;
    if (prev) {
      const changed: string[] = [];
      for (const field of QUAL_FIELDS) {
        if (!busy.has(field) && prev[field] !== fresh[field] && fresh.iaFields.includes(IA_KEY[field])) changed.push(IA_KEY[field]);
      }
      if (!busy.has("entradas")) {
        if (prev.numEntradas !== fresh.numEntradas && fresh.iaFields.includes("num_entradas")) changed.push("num_entradas");
        const anchos = (d: Details) => d.entradas.map((e) => `${e.posicion}:${e.anchoCm ?? ""}`).join(",");
        if (anchos(prev) !== anchos(fresh) && fresh.iaFields.some((k) => k.startsWith("entrada_"))) changed.push("entradas");
      }
      if (etapaByAgent.current && fresh.iaFields.includes("etapa")) changed.push("etapa");
      etapaByAgent.current = false;
      flashKeys(changed);
    }
    setDetails((d) => {
      if (!d) return d;
      const next: Details = { ...d, anuncio: fresh.anuncio, anuncios: fresh.anuncios, email: fresh.email, tags: fresh.tags };
      for (const field of QUAL_FIELDS) if (!busy.has(field)) copyField(next, freshQ, field);
      if (!busy.has("entradas")) {
        next.numEntradas = fresh.numEntradas;
        next.entradas = fresh.entradas;
      }
      // Marca "IA" (parte 1): la del servidor, salvo en lo que el vendedor está guardando
      // ahí mismo (ahí manda lo local: al editarlo, el campo ya es suyo).
      const busyKey = (k: string) =>
        QUAL_FIELDS.some((f) => busy.has(f) && IA_KEY[f] === k) || (busy.has("entradas") && (k === "num_entradas" || k.startsWith("entrada_")));
      next.iaFields = [...fresh.iaFields.filter((k) => !busyKey(k)), ...d.iaFields.filter(busyKey)];
      return next;
    });
    const free = (lane: string, draft: string) => !busy.has(lane) && !typing.current.has(draft);
    if (free("nivelAguaCm", "nivelCm")) setNivelCm(fresh.nivelAguaCm === null ? "" : String(fresh.nivelAguaCm));
    if (free("nivelAguaTexto", "nivelTexto")) setNivelTexto(fresh.nivelAguaTexto ?? "");
    if (free("montoCotizacion", "monto")) setMonto(fresh.montoCotizacion === null ? "" : money.format(fresh.montoCotizacion));
    if (free("pagoTotal", "pago")) setPago(fresh.pagoTotal === null ? "" : money.format(fresh.pagoTotal));
    if (free("entradas", "numEntradas")) setNumEntradasDraft(fresh.numEntradas === null ? "" : String(fresh.numEntradas));
  }

  // Guarda UN campo de la calificación. El valor se muestra al instante; si su
  // último guardado falla, el campo (y su borrador, vía `show`) vuelve a lo
  // último que el servidor guardó, no a lo que había cuando se pidió.
  function saveField<K extends QualField>(field: K, value: Qualification[K], show?: (saved: Qualification[K]) => void) {
    // Lo editó un vendedor: deja de ser del Agente IA (sin marca "IA").
    setDetails((d) => (d ? { ...d, [field]: value, iaFields: d.iaFields.filter((k) => k !== IA_KEY[field]) } : d));
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
    field: "nivelAguaCm" | "montoCotizacion" | "pagoTotal",
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
    // Con el encabezado y su botón (`action`): en móvil el detalle cubre la pantalla y
    // sin la ✕ no habría cómo cerrarlo mientras reintenta.
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Detalle del contacto</h2>
          {action}
        </div>
        <p className="p-4 text-sm text-brand-orange">No se pudo cargar el detalle del contacto. Reintentando…</p>
      </div>
    );
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
          abajo. */}
      {(status.state === "error" || error) && (
        <p role="alert" className="border-b bg-brand-orange/10 px-4 py-1.5 text-xs text-brand-orange">
          {status.state === "error" ? status.message : error}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">

        <div>
          <p className="font-medium break-words">{name}</p>
          <p className="text-xs text-muted-foreground">{contactHandle(phone, instagramUsername)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label data-ia-flash={lit("etapa") ? "" : undefined} className="-mx-1 space-y-1 px-1 py-0.5">
            <span className="flex min-h-5 items-center justify-between gap-1">
              <span className={label}>Etapa</span>
              {details?.iaFields.includes("etapa") && <IaMark active={lit("etapa")} />}
            </span>
            <select
              value={stage}
              disabled={busy}
              onChange={(e) => {
                // La cambió un vendedor: deja de ser del agente (sin marca "IA").
                setDetails((d) => (d ? { ...d, iaFields: d.iaFields.filter((k) => k !== "etapa") } : d));
                onStageChange(e.target.value as Stage);
              }}
              className={`${input} disabled:opacity-60`}
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
              {/* La etapa del contacto ya no existe (se borró hace un instante): se ve hasta releer. */}
              {!stages.some((s) => s.key === stage) && <option value={stage}>{stage}</option>}
            </select>
          </label>
          <label className="-mx-1 space-y-1 px-1 py-0.5">
            <span className="flex min-h-5 items-center">
              <span className={label}>Temperatura</span>
            </span>
            {onDestacadoChange ? (
              <TemperatureDestacadoMenu
                temperature={temperature}
                destacado={destacado === true}
                disabled={busy}
                onTemperatureChange={onTemperatureChange}
                onDestacadoChange={onDestacadoChange}
                className={input}
              />
            ) : (
              <select
                value={temperature && TEMPERATURES.includes(temperature) ? temperature : ""}
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
            )}
          </label>
        </div>

        {details === null ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : (
          <>
            <Section title="Calificación">
            {/* El Agente IA en segundo plano: en espera, leyendo, actualizó o al día. */}
            <LectorStatusLine contactId={contactId} />
            <Field title="¿Tiene problemas de inundaciones?" ia={details.iaFields.includes("tiene_inundaciones")} flash={lit("tiene_inundaciones")}>
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

            <Field
              title="¿Cuánta agua entra?"
              ia={details.iaFields.includes("nivel_agua_cm") || details.iaFields.includes("nivel_agua_texto")}
              flash={lit("nivel_agua_cm", "nivel_agua_texto")}
            >
              <div className="flex gap-2">
                <div className="relative w-24 shrink-0">
                  <input
                    aria-label="Nivel de agua (cm)"
                    inputMode="numeric"
                    value={nivelCm}
                    onChange={(e) => {
                      typing.current.add("nivelCm");
                      setNivelCm(e.target.value);
                    }}
                    onBlur={() => {
                      typing.current.delete("nivelCm");
                      onNumberBlur(
                        nivelCm,
                        details.nivelAguaCm,
                        { integer: true, min: 0, max: 1000 },
                        "nivelAguaCm",
                        (v) => setNivelCm(v === null ? "" : String(v)),
                        "El nivel debe ser un entero de 0 a 1000 cm.",
                      );
                    }}
                    className={`${input} pr-8`}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">cm</span>
                </div>
                <input
                  aria-label="Descripción del nivel de agua"
                  placeholder="Descripción (opcional)"
                  value={nivelTexto}
                  maxLength={500}
                  onChange={(e) => {
                    typing.current.add("nivelTexto");
                    setNivelTexto(e.target.value);
                  }}
                  onBlur={() => {
                    typing.current.delete("nivelTexto");
                    const next = nivelTexto.trim() || null;
                    if (next !== details.nivelAguaTexto) saveField("nivelAguaTexto", next, (saved) => setNivelTexto(saved ?? ""));
                  }}
                  className={input}
                />
              </div>
            </Field>

            <Field title="¿Cuántas entradas?" ia={details.iaFields.includes("num_entradas")} flash={lit("num_entradas")}>
              <input
                aria-label="Número de entradas"
                inputMode="numeric"
                value={numEntradas}
                onChange={(e) => {
                  typing.current.add("numEntradas");
                  setNumEntradasDraft(e.target.value);
                }}
                onBlur={() => {
                  typing.current.delete("numEntradas");
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
                  setDetails((d) => (d ? { ...d, numEntradas: value, iaFields: d.iaFields.filter((k) => k !== "num_entradas") } : d));
                  void run(() => syncEntradas(() => setNumEntradas(contactId, value)));
                }}
                className={`${input} w-24`}
              />
            </Field>

            {details.entradas.length > 0 && (
              <Field title="Ancho de cada entrada y tamaño de compuerta sugerido" flash={lit("entradas")}>
                <ContactEntradas
                  contactId={contactId}
                  entradas={details.entradas as Entrada[]}
                  iaFields={details.iaFields}
                  run={run}
                  saves={saves}
                  onSaved={(next) =>
                    setDetails((d) => (d ? { ...d, entradas: d.entradas.map((e) => (e.posicion === next.posicion ? next : e)) } : d))
                  }
                />
              </Field>
            )}

            {/* Monto de cotización = total de lo que el cliente eligió al final; Pago total = lo que
                ya pagó (regla del dueño, 28-sep-2026). Lado a lado: se ve si cotizó mucho y no compró. */}
            <div className="grid grid-cols-2 items-end gap-2">
              <Field title="Monto de cotización (MXN)" ia={details.iaFields.includes("monto_cotizacion")} flash={lit("monto_cotizacion")}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <input
                    aria-label="Monto de cotización en MXN"
                    inputMode="decimal"
                    value={monto}
                    onChange={(e) => {
                      typing.current.add("monto");
                      setMonto(e.target.value);
                    }}
                    onBlur={() => {
                      typing.current.delete("monto");
                      onNumberBlur(
                        monto,
                        details.montoCotizacion,
                        { integer: false, min: 0, max: 9_999_999_999.99 },
                        "montoCotizacion",
                        (v) => setMonto(v === null ? "" : money.format(v)),
                        "El monto debe ser un número positivo.",
                      );
                    }}
                    className={`${input} pl-5`}
                  />
                </div>
              </Field>
              <Field title="Pago total (MXN)" ia={details.iaFields.includes("pago_total")} flash={lit("pago_total")}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <input
                    aria-label="Pago total en MXN"
                    inputMode="decimal"
                    value={pago}
                    onChange={(e) => {
                      typing.current.add("pago");
                      setPago(e.target.value);
                    }}
                    onBlur={() => {
                      typing.current.delete("pago");
                      onNumberBlur(
                        pago,
                        details.pagoTotal,
                        { integer: false, min: 0, max: 9_999_999_999.99 },
                        "pagoTotal",
                        (v) => setPago(v === null ? "" : money.format(v)),
                        "El pago debe ser un número positivo.",
                      );
                    }}
                    className={`${input} pl-5`}
                  />
                </div>
              </Field>
            </div>

            {/* Solo lo decide el Agente IA conforme avanza la conversación (sin selector). */}
            <Field
              title="% de convencimiento"
              ia={details.iaFields.includes("porcentaje_convencimiento")}
              flash={lit("porcentaje_convencimiento")}
            >
              <ConvencimientoBar value={details.porcentajeConvencimiento} />
            </Field>
            </Section>

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

            {/* El ÚNICO control del agente en esta conversación (26-sep-2026). */}
            <Section title="Agente IA">
              <AgentContactSwitch contactId={contactId} conversationId={conversationId} />
            </Section>

            <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
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
