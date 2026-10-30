"use client";

// Sección «Links de pago» de la pestaña Agente IA (30-oct-2026; reglas en lib/agente-ia/links-pago.ts):
// los links de MercadoPago que manda el Agente IA cuando el cliente elige pagar con tarjeta y que el
// vendedor tiene en el ⚡ del chat (los «Solo vendedor», solo ahí), y los dos mensajes que salen con cada
// link. Se valida aquí con las mismas funciones del servidor para mostrar los errores antes de guardar.
// «Guardar links» pide confirmación arriba (use-confirm.tsx) y avisa hacia arriba si hay cambios sin guardar.
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { saveLinksPago } from "@/lib/actions/links-pago";
import {
  CUBRE_LABEL,
  MAX_TEXTO_LINK,
  mensajesLink,
  TEXTOS_DE_FABRICA,
  validateLinksPago,
  validateTextosLink,
  type LinkCubre,
  type LinkPago,
  type LinkPagoInput,
  type TextosLink,
} from "@/lib/agente-ia/links-pago";
import { useConfirm } from "./use-confirm";

const MESES = [0, 3, 6, 9, 12, 18, 24];

type Row = { key: string; nombre: string; monto: string; cubre: LinkCubre; meses: number; url: string; soloVendedor: boolean };

let seq = 0;
const newKey = () => `l${++seq}`;

const toRows = (links: readonly LinkPago[]): Row[] =>
  links.map((l) => ({ key: newKey(), nombre: l.nombre, monto: String(l.monto), cubre: l.cubre, meses: l.meses, url: l.url, soloVendedor: l.soloVendedor }));

// «5,500» o «$5500» → 5500; algo que no es número → NaN (lo marca la validación).
const montoDe = (v: string) => (v.trim() === "" ? Number.NaN : Number(v.replace(/[$,\s]/g, "")));

const toInput = (rows: readonly Row[]): LinkPagoInput[] =>
  rows.map((r) => ({ nombre: r.nombre.trim(), monto: montoDe(r.monto), cubre: r.cubre, meses: r.meses, url: r.url.trim(), soloVendedor: r.soloVendedor }));

const field = "w-full rounded border bg-background px-2 py-1 text-sm";
const label = "mb-0.5 block text-xs text-muted-foreground";

export function LinksPagoSection({ initial, textos: textosIniciales, onDirtyChange }: { initial: LinkPago[]; textos: TextosLink; onDirtyChange?: (dirty: boolean) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [textos, setTextos] = useState<TextosLink>(textosIniciales);
  const [savedKey, setSavedKey] = useState(() => JSON.stringify({ links: toInput(toRows(initial)), textos: textosIniciales }));
  const confirm = useConfirm();
  // Ids de los campos por posición (la `key` de cada fila sale de un contador y no coincide entre servidor y navegador).
  const uid = useId();

  const input = toInput(rows);
  const montosOk = input.every((l) => Number.isFinite(l.monto));
  const errors = [...(montosOk ? validateLinksPago(input) : ["El monto debe ser un número (por ejemplo 5500)."]), ...validateTextosLink(textos)];
  const dirty = JSON.stringify({ links: input, textos }) !== savedKey;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function move(key: string, delta: -1 | 1) {
    setRows((current) => {
      const i = current.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= current.length) return current;
      const next = [...current];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function save() {
    const toSave = { links: input, textos };
    confirm.ask({
      title: "¿Guardar los links de pago?",
      body: "Desde ahora el Agente IA manda estos links (menos los «Solo vendedor») a quien elija pagar con tarjeta, si cobran el total acordado en el chat, y el ⚡ del chat los muestra con estos dos mensajes.",
      confirmLabel: "Sí, guardar",
      pendingLabel: "Guardando…",
      done: "Listo: links de pago guardados",
      run: () => saveLinksPago(toSave),
      onDone: (result) => {
        setRows(toRows(result.links));
        setTextos(result.textos);
        setSavedKey(JSON.stringify({ links: toInput(toRows(result.links)), textos: result.textos }));
        router.refresh();
      },
    });
  }

  const textoField = (n: 1 | 2, hint: string) => {
    const key = n === 1 ? "mensaje1" : "mensaje2";
    return (
      <div>
        <label className={label} htmlFor={`${uid}-texto-${n}`}>
          {n === 1 ? "Mensaje 1 (con el link)" : "Mensaje 2 (aparte, después del link)"}
        </label>
        <textarea
          id={`${uid}-texto-${n}`}
          value={textos[key]}
          rows={n === 1 ? 4 : 6}
          maxLength={MAX_TEXTO_LINK + 100}
          onChange={(e) => setTextos((t) => ({ ...t, [key]: e.target.value }))}
          className={`${field} resize-y`}
        />
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{hint}</span>
          {textos[key] !== TEXTOS_DE_FABRICA[key] && (
            <button type="button" onClick={() => setTextos((t) => ({ ...t, [key]: TEXTOS_DE_FABRICA[key] }))} className="rounded px-1.5 py-0.5 hover:bg-muted">
              Volver al de fábrica
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        El Agente IA elige el link según lo que compró el cliente y el CRM lo manda tal cual, solo si cobra el total
        acordado en el chat (o la mitad, en el anticipo o la liquidación de una compuerta a la medida). Los marcados
        «Solo vendedor» (precio especial, Los Mochis) el Agente IA nunca los ve: salen solo en el ⚡ del chat. Nunca se
        mandan a un número de fuera de México (los +1 sí).
      </p>

      {rows.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Sin links: el Agente IA le dice al cliente que un asesor le manda el link.</p>}

      <ul className="space-y-3">
        {rows.map((r, i) => {
          const monto = montoDe(r.monto);
          return (
            <li key={r.key} className="rounded-lg border bg-card p-3">
              <div className="grid gap-2 sm:grid-cols-[1.6fr_0.8fr_1.3fr_1fr]">
                <div>
                  <label className={label} htmlFor={`${uid}-${i}-nombre`}>Nombre</label>
                  <input id={`${uid}-${i}-nombre`} value={r.nombre} placeholder="1 compuerta estándar" onChange={(e) => update(r.key, { nombre: e.target.value })} className={field} />
                </div>
                <div>
                  <label className={label} htmlFor={`${uid}-${i}-monto`}>Monto ($)</label>
                  <input id={`${uid}-${i}-monto`} inputMode="decimal" value={r.monto} placeholder="5500" onChange={(e) => update(r.key, { monto: e.target.value })} className={field} />
                </div>
                <div>
                  <label className={label} htmlFor={`${uid}-${i}-cubre`}>Cobra</label>
                  <select id={`${uid}-${i}-cubre`} value={r.cubre} onChange={(e) => update(r.key, { cubre: e.target.value as LinkCubre })} className={field}>
                    {(Object.keys(CUBRE_LABEL) as LinkCubre[]).map((c) => (
                      <option key={c} value={c}>
                        {CUBRE_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor={`${uid}-${i}-meses`}>Pago</label>
                  <select id={`${uid}-${i}-meses`} value={r.meses} onChange={(e) => update(r.key, { meses: Number(e.target.value) })} className={field}>
                    {MESES.map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? "De contado" : `Hasta ${m} MSI`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-2">
                <label className={label} htmlFor={`${uid}-${i}-url`}>Link de MercadoPago</label>
                <input id={`${uid}-${i}-url`} type="url" inputMode="url" value={r.url} placeholder="https://mpago.la/…" onChange={(e) => update(r.key, { url: e.target.value })} className={`${field} font-mono`} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <label className="mr-2 flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={r.soloVendedor} onChange={(e) => update(r.key, { soloVendedor: e.target.checked })} className="size-3.5 accent-brand-navy" />
                  Solo vendedor (el Agente IA no lo manda)
                </label>
                {Number.isFinite(monto) && monto > 0 && r.url.trim() && (
                  <details className="mr-auto min-w-0 basis-full text-xs sm:basis-auto">
                    <summary className="cursor-pointer text-muted-foreground">Así le llega al cliente</summary>
                    <div className="mt-1 space-y-1.5">
                      {mensajesLink({ monto, meses: r.meses, url: r.url }, textos).map((m, j) => (
                        <p key={j} className="whitespace-pre-wrap break-words rounded bg-muted p-2 text-foreground">
                          {m}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
                <button type="button" aria-label={`Subir ${r.nombre || "link"}`} disabled={i === 0} onClick={() => move(r.key, -1)} className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">
                  ↑
                </button>
                <button type="button" aria-label={`Bajar ${r.nombre || "link"}`} disabled={i === rows.length - 1} onClick={() => move(r.key, 1)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">
                  ↓
                </button>
                <button type="button" aria-label={`Quitar ${r.nombre || "link"}`} onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                  Quitar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setRows((current) => [...current, { key: newKey(), nombre: "", monto: "", cubre: "total", meses: 0, url: "", soloVendedor: false }])}
        className="rounded px-2 py-1 text-xs text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300"
      >
        + Agregar link
      </button>

      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div>
          <h3 className="text-sm font-semibold">Mensajes que salen con cada link</h3>
          <p className="text-xs text-muted-foreground">
            Primero sale el mensaje 1 con el link y después, aparte, el mensaje 2. Valen para el Agente IA y para el ⚡ del
            chat. Si dejas vacío el mensaje 2, solo sale el 1.
          </p>
        </div>
        {textoField(1, "{{monto}} = el monto del link · {{link}} = el link (obligatorio) · {{forma_de_pago}} = meses sin intereses o de contado")}
        {textoField(2, "Por ejemplo, los datos de envío que se piden después del pago.")}
      </div>

      {errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-brand-orange">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {confirm.error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={confirm.pending || errors.length > 0 || !dirty}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {confirm.pending ? "Guardando…" : "Guardar links"}
        </button>
        {dirty && <span className="text-xs text-muted-foreground">Cambios sin guardar.</span>}
      </div>
      {confirm.ui}
    </div>
  );
}
