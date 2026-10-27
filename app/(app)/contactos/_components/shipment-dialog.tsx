"use client";

// Ventana «Hacer guía de envío» del Detalle (guías de Envia, 27-oct-2026; docs/envios.md). Solo pide lo que se usa
// (nombre, teléfono, calle, número, CP, colonia, ciudad y estado) y llega casi llena: quien recibe y su teléfono
// del contacto (o la dirección de su última guía) y una compuerta por entrada con el embalaje de Envia de su
// talla. El CP trae estado, ciudad y colonias. Reglas fijas a la vista: una guía por compuerta, valor declarado
// $4,000 y la nota «Compuerta Anti-Inundaciones»; sin seguro ni servicios adicionales.
// «Cotizar» pide precio a Paquetexpress y Estafeta (viene marcada la más barata A DOMICILIO; las variantes
// «Ocurre» de sucursal se ven con su explicación) y «Generar guía por $X» la
// hace con UN clic: la llave de esta ventana evita una segunda guía por doble clic. Cambiar un dato después
// de cotizar borra la cotización (el precio podría ser otro). Con la cuenta real y el candado del saldo cerrado
// (ENVIA_GENERAR, docs/envios.md) solo se cotiza: no hay botón de generar. Sin lógica de datos: todo pasa por
// las acciones.
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { buscarCodigoPostal, cotizarEnvio, generarGuia, getEnvioForm, type EnvioForm } from "@/lib/actions/envios";
import type { SavedPackage } from "@/lib/envia/client";
import { DEFAULT_CONTENT, EMPTY_PACKAGE, FIXED_DECLARED_VALUE, FIXED_NOTE, draftFromSaved, type PackageDraft } from "@/lib/envios/form";
import type { QuoteOption } from "@/lib/envios/service";
import { carrierLabel, preferredOptionIndex, priceLabel, reviewReason, serviceHint, serviceName } from "@/lib/envios/messages";
import type { ShipmentView } from "@/lib/envios/store";
import { PruebaBadge } from "@/components/ui/prueba-badge";
import { ArcoDialog } from "./arco-dialog";

type FormData = Extract<EnvioForm, { ok: true }>;

type Dest = {
  name: string;
  phone: string;
  email: string | null;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  stateName: string;
  postalCode: string;
  reference: string;
};

type Quote = { options: QuoteOption[]; errors: { carrier: string; message: string }[]; guides: number; selected: number | null };

const input =
  "w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";
const label = "block space-y-1 text-xs text-muted-foreground";

function destFrom(d: FormData["destination"]): Dest {
  return {
    name: d.name ?? "",
    phone: d.phone ?? "",
    email: d.email ?? null,
    street: d.street ?? "",
    number: d.number ?? "",
    district: d.district ?? "",
    city: d.city ?? "",
    state: d.state ?? "",
    stateName: d.stateName ?? "",
    postalCode: d.postalCode ?? "",
    reference: d.reference ?? "",
  };
}

const dims = (p: Pick<SavedPackage, "lengthCm" | "widthCm" | "heightCm" | "weightKg">) =>
  `${p.lengthCm}×${p.widthCm}×${p.heightCm} cm, ${p.weightKg} kg`;

const optionKey = (o: QuoteOption) => `${o.carrier}:${o.service}`;

export function ShipmentDialog({
  contactId,
  onClose,
  onCreated,
  onPartial,
}: {
  contactId: string;
  onClose: () => void;
  /** Guías creadas (una por compuerta). */
  onCreated: (shipments: ShipmentView[]) => void;
  /** Algunas se crearon y otra falló: la sección las muestra ya. */
  onPartial: (shipments: ShipmentView[]) => void;
}) {
  const [phase, setPhase] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "form"; data: FormData }>({
    kind: "loading",
  });
  const [dest, setDest] = useState<Dest>(destFrom({}));
  const [colonias, setColonias] = useState<string[]>([]);
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageDraft[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<"cotizando" | "generando" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Llave de esta ventana: la misma en cada reintento (las guías ya creadas no se vuelven a cobrar; la que falló se
  // reintenta en su misma fila).
  const requestKey = useRef<string>(crypto.randomUUID());
  const zipAsked = useRef<string>("");

  useEffect(() => {
    let alive = true;
    void getEnvioForm(contactId)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setPhase({ kind: "error", message: res.message });
          return;
        }
        setDest(destFrom(res.destination));
        setColonias(res.zip?.colonias ?? []);
        setPackages(res.packages);
        setPhase({ kind: "form", data: res });
      })
      .catch(() => {
        if (alive) setPhase({ kind: "error", message: "No se pudo preparar la guía. Revisa tu conexión." });
      });
    return () => {
      alive = false;
    };
  }, [contactId]);

  const saved = phase.kind === "form" ? phase.data.savedPackages : [];
  const sandbox = phase.kind === "form" && phase.data.env === "sandbox";
  const canGenerate = phase.kind === "form" && phase.data.canGenerate;

  // Cualquier cambio después de cotizar borra la cotización.
  function touched() {
    setQuote(null);
    setError(null);
  }

  function setField<K extends keyof Dest>(key: K, value: Dest[K]) {
    setDest((d) => ({ ...d, [key]: value }));
    touched();
  }

  async function lookupZip(cp: string) {
    if (!/^\d{5}$/.test(cp) || zipAsked.current === cp) return;
    zipAsked.current = cp;
    setZipNote("Buscando el código postal…");
    const res = await buscarCodigoPostal(cp).catch(() => null);
    if (zipAsked.current !== cp) return;
    if (!res || !res.ok) {
      setZipNote(res?.message ?? "No se pudo buscar el código postal.");
      return;
    }
    if (!res.zip) {
      setColonias([]);
      setDest((d) => ({ ...d, state: "", stateName: "" }));
      setZipNote("Ese código postal no existe en Envia.");
      return;
    }
    const zip = res.zip;
    setColonias(zip.colonias);
    setDest((d) => ({
      ...d,
      state: zip.state,
      stateName: zip.stateName,
      city: zip.city || d.city,
      district: zip.colonias.includes(d.district) ? d.district : zip.colonias.length === 1 ? zip.colonias[0]! : d.district,
    }));
    setZipNote(null);
  }

  function setPackage(i: number, patch: Partial<PackageDraft>) {
    setPackages((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    touched();
  }

  function pickPackage(i: number, value: string) {
    const found = saved.find((p) => p.id === value);
    setPackages((list) =>
      list.map((p, j) => (j === i ? (found ? draftFromSaved(found) : { ...EMPTY_PACKAGE, content: p.content || DEFAULT_CONTENT }) : p)),
    );
    touched();
  }

  function payload() {
    return {
      contactId,
      destination: dest,
      packages: packages.map((p) => ({
        packageName: p.packageName,
        content: p.content,
        lengthCm: p.lengthCm,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        weightKg: p.weightKg,
      })),
    };
  }

  async function quoteNow() {
    setBusy("cotizando");
    setError(null);
    const res = await cotizarEnvio(payload()).catch(() => null);
    setBusy(null);
    if (!res) return setError("No se pudo cotizar. Revisa tu conexión.");
    if (!res.ok) return setError(res.message);
    if (res.options.length === 0) {
      setQuote({ options: [], errors: res.errors, guides: res.guides, selected: null });
      return setError("Ninguna paquetería dio precio para este envío.");
    }
    setQuote({ options: res.options, errors: res.errors, guides: res.guides, selected: preferredOptionIndex(res.options) });
  }

  async function generateNow() {
    const option = quote?.selected !== null && quote ? quote.options[quote.selected] : undefined;
    if (!option) return;
    setBusy("generando");
    setError(null);
    const res = await generarGuia({
      ...payload(),
      requestKey: requestKey.current,
      carrier: option.carrier,
      service: option.service,
      serviceLabel: option.serviceLabel,
    }).catch(() => null);
    setBusy(null);
    if (!res) return setError("No se supo si la guía se generó (falló la conexión). Vuelve a intentar: no se cobra dos veces.");
    if (!res.ok) {
      // Las que sí se crearon ya quedan en la sección; el reintento solo pide las que faltan.
      if (res.shipments.length > 0) onPartial(res.shipments);
      return setError(res.message);
    }
    onCreated(res.shipments);
  }

  const selected = quote?.selected !== null && quote ? quote.options[quote.selected] : undefined;
  const guides = quote?.guides ?? packages.length;
  const review = quote && quote.options.length > 0 ? reviewReason(quote.options) : null;

  return (
    <ArcoDialog
      wide
      title="Hacer guía de envío"
      titleExtra={sandbox ? <PruebaBadge /> : undefined}
      onClose={() => {
        if (busy !== "generando") onClose();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy === "generando"} className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          {phase.kind === "form" &&
            (selected && canGenerate ? (
              <button
                type="button"
                onClick={() => void generateNow()}
                disabled={busy !== null}
                className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:opacity-60"
              >
                {busy === "generando"
                  ? "Generando…"
                  : `Generar ${guides === 1 ? "guía" : `${guides} guías`} por ${priceLabel(selected.price)}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void quoteNow()}
                disabled={busy !== null}
                className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-60"
              >
                {busy === "cotizando" ? "Cotizando…" : "Cotizar"}
              </button>
            ))}
        </>
      }
    >
      {phase.kind === "loading" && <p className="text-muted-foreground">Preparando la guía…</p>}

      {phase.kind === "error" && (
        <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
          ⚠ {phase.message}
        </p>
      )}

      {phase.kind === "form" && (
        <div className="space-y-3">
          {sandbox && (
            <p className="text-xs text-muted-foreground">Cuenta de pruebas de Envia: la guía no es real y no cuesta.</p>
          )}
          {!canGenerate && (
            <p className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
              Solo cotizar: con la cuenta real de Envia este servidor no genera guías (no se gasta saldo).
            </p>
          )}

          <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2" disabled={busy === "generando"}>
            <label className={label}>
              Recibe
              <input className={input} value={dest.name} onChange={(e) => setField("name", e.target.value)} autoComplete="off" />
            </label>
            <label className={label}>
              Teléfono (10 dígitos)
              <input className={input} value={dest.phone} inputMode="tel" onChange={(e) => setField("phone", e.target.value)} autoComplete="off" />
            </label>
            <label className={label}>
              Código postal
              <input
                className={input}
                value={dest.postalCode}
                inputMode="numeric"
                maxLength={5}
                onChange={(e) => {
                  const cp = e.target.value.replace(/\D/g, "").slice(0, 5);
                  setField("postalCode", cp);
                  if (cp.length === 5) void lookupZip(cp);
                }}
                onBlur={() => void lookupZip(dest.postalCode)}
                autoComplete="off"
              />
              {zipNote && <span className="block text-[11px] text-brand-orange">{zipNote}</span>}
            </label>
            <label className={label}>
              Colonia
              <input
                className={input}
                value={dest.district}
                list={`colonias-${contactId}`}
                onChange={(e) => setField("district", e.target.value)}
                placeholder={colonias.length ? "Elige o escribe" : ""}
                autoComplete="off"
                data-sin-escritura=""
              />
              <datalist id={`colonias-${contactId}`}>
                {colonias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className={label}>
              Calle
              <input className={input} value={dest.street} onChange={(e) => setField("street", e.target.value)} autoComplete="off" />
            </label>
            <label className={label}>
              Número (exterior e interior)
              <input className={input} value={dest.number} onChange={(e) => setField("number", e.target.value)} autoComplete="off" />
            </label>
            <label className={label}>
              Ciudad
              <input className={input} value={dest.city} onChange={(e) => setField("city", e.target.value)} autoComplete="off" />
            </label>
            <div className={label}>
              Estado
              <p className="py-1.5 text-sm text-foreground">{dest.stateName || <span className="text-muted-foreground">Sale del código postal</span>}</p>
            </div>
          </fieldset>

          <fieldset className="space-y-2" disabled={busy === "generando"}>
            <legend className="text-xs text-muted-foreground">Compuertas: una guía por cada una (embalajes guardados en Envia)</legend>
            {packages.map((p, i) => (
              <div key={i} className="space-y-1.5 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <select
                    className={input}
                    value={p.packageId ?? "manual"}
                    onChange={(e) => pickPackage(i, e.target.value)}
                    aria-label={`Compuerta ${i + 1}`}
                  >
                    {saved.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({dims(s)})
                      </option>
                    ))}
                    <option value="manual">Medidas a mano (a la medida)</option>
                  </select>
                  {packages.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Quitar compuerta ${i + 1}`}
                      onClick={() => {
                        setPackages((list) => list.filter((_, j) => j !== i));
                        touched();
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                {p.packageId === null && (
                  <div className="grid grid-cols-4 gap-2">
                    {(
                      [
                        ["lengthCm", "Largo cm"],
                        ["widthCm", "Ancho cm"],
                        ["heightCm", "Alto cm"],
                        ["weightKg", "Peso kg"],
                      ] as const
                    ).map(([key, text]) => (
                      <label key={key} className={label}>
                        {text}
                        <input
                          className={input}
                          inputMode="decimal"
                          value={p[key] || ""}
                          onChange={(e) => setPackage(i, { [key]: Number(e.target.value.replace(",", ".")) || 0 })}
                          autoComplete="off"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setPackages((list) => [...list, saved[0] ? draftFromSaved(saved[0]) : { ...EMPTY_PACKAGE }]);
                touched();
              }}
              className="inline-flex items-center gap-1 text-xs"
              data-link="text"
            >
              <Plus className="size-3.5" /> Agregar compuerta
            </button>
          </fieldset>

<p className="text-xs text-muted-foreground">
            Cada guía: valor declarado {priceLabel(FIXED_DECLARED_VALUE)} · nota «{FIXED_NOTE}» · sin seguro ni servicios adicionales.
          </p>

          {review && (
            <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
              ⚠ {review}
            </p>
          )}
          {quote && quote.options.length > 0 && (
            <div role="radiogroup" aria-label="Paquetería" className="overflow-hidden rounded-md border">
              {quote.options.map((o, i) => (
                <label
                  key={optionKey(o)}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${i > 0 ? "border-t" : ""} ${
                    quote.selected === i ? "bg-brand-navy/10" : "hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name={`tarifa-${contactId}`} checked={quote.selected === i} onChange={() => setQuote({ ...quote, selected: i })} />
                    <span>
                      {carrierLabel(o.carrier)} · {serviceName(o.carrier, o.serviceLabel)}
                      <span className="block text-xs text-muted-foreground">
                        {o.dropOff ?? serviceHint(o.service)}
                        {o.delivery && ` · ${o.delivery}`}
                        {quote.guides > 1 && ` · ${quote.guides} guías`}
                      </span>
                      {o.extendedFare > 0 && (
                        <span className="block text-xs font-medium text-brand-orange">Zona extendida (+{priceLabel(o.extendedFare)})</span>
                      )}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{priceLabel(o.price)}</span>
                </label>
              ))}
            </div>
          )}
          {quote?.errors.map((e) => (
            <p key={e.carrier} className="text-xs text-muted-foreground">
              {carrierLabel(e.carrier)} no cotizó: {e.message}
            </p>
          ))}

          {error && (
            <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
              ⚠ {error}
            </p>
          )}
        </div>
      )}
    </ArcoDialog>
  );
}
