"use client";

// Rangos de tallas de compuerta por línea (A7), editables por owner/admin. La
// sugerencia de talla de cada entrada busca SOLO dentro de su línea; fuera de
// rango → sin sugerencia. Se valida aquí con la misma función del servidor
// (lib/contacts/sizes.ts) para mostrar los errores antes de guardar.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { replaceSizeRanges } from "@/lib/actions/contact-qualification";
import { validateSizeRanges, type LineaCompuerta, type SizeRange } from "@/lib/contacts/sizes";

const LINEAS: { key: LineaCompuerta; label: string }[] = [
  { key: "mini", label: "Línea mini" },
  { key: "estandar", label: "Línea estándar" },
];

type Row = { key: string; linea: LineaCompuerta; talla: string; minCm: string; maxCm: string };

let seq = 0;
const newKey = () => `r${++seq}`;

function toRows(ranges: SizeRange[]): Row[] {
  return [...ranges]
    .sort((a, b) => a.linea.localeCompare(b.linea) || a.posicion - b.posicion)
    .map((r) => ({ key: newKey(), linea: r.linea, talla: r.talla, minCm: String(r.minCm), maxCm: String(r.maxCm) }));
}

function toRanges(rows: Row[]): SizeRange[] {
  const position: Record<LineaCompuerta, number> = { mini: 0, estandar: 0 };
  return rows.map((r) => ({
    linea: r.linea,
    talla: r.talla.trim(),
    minCm: Number(r.minCm),
    maxCm: Number(r.maxCm),
    posicion: ++position[r.linea],
  }));
}

const cell = "w-full rounded border bg-background px-2 py-1 text-sm";

export function SizeRangesPanel({ initial }: { initial: SizeRange[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const ranges = toRanges(rows);
  const numbersOk = rows.every((r) => /^\d+$/.test(r.minCm) && /^\d+$/.test(r.maxCm));
  const errors = numbersOk ? validateSizeRanges(ranges) : ["Mínimo y máximo deben ser números enteros de cm."];

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await replaceSizeRanges(ranges);
      setMessage({ ok: true, text: "Rangos guardados. Las sugerencias de las entradas se recalcularon." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "No se pudieron guardar los rangos." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Rangos de ancho (cm) por talla. Dentro de una línea no se pueden encimar; entre líneas sí (por ejemplo, 90 cm
        cabe en mini M y en estándar).
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {LINEAS.map((linea) => (
          <div key={linea.key} className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{linea.label}</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 font-medium">Talla</th>
                  <th className="pb-1 font-medium">Desde (cm)</th>
                  <th className="pb-1 font-medium">Hasta (cm)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.linea === linea.key)
                  .map((r) => (
                    <tr key={r.key}>
                      <td className="py-0.5 pr-1">
                        <input aria-label="Talla" value={r.talla} onChange={(e) => update(r.key, { talla: e.target.value })} className={cell} />
                      </td>
                      <td className="py-0.5 pr-1">
                        <input aria-label="Desde (cm)" inputMode="numeric" value={r.minCm} onChange={(e) => update(r.key, { minCm: e.target.value })} className={cell} />
                      </td>
                      <td className="py-0.5 pr-1">
                        <input aria-label="Hasta (cm)" inputMode="numeric" value={r.maxCm} onChange={(e) => update(r.key, { maxCm: e.target.value })} className={cell} />
                      </td>
                      <td className="py-0.5">
                        <button
                          type="button"
                          aria-label={`Quitar ${r.talla || "talla"}`}
                          onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={() => setRows((current) => [...current, { key: newKey(), linea: linea.key, talla: "", minCm: "", maxCm: "" }])}
              className="mt-2 rounded px-2 py-1 text-xs text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300"
            >
              + Agregar talla
            </button>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-brand-orange">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-brand-orange"}`}>{message.text}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || errors.length > 0}
        className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Guardar rangos"}
      </button>
    </div>
  );
}
