"use client";

// Sección "Tallas y medidas" de la pestaña Agente IA (antes Configuración → Tallas,
// hasta el 26-sep-2026): rangos de ancho (cm) por tamaño y línea, editables por
// todos los roles. La sugerencia de tamaño de cada entrada del Detalle busca SOLO
// dentro de su línea; fuera de rango → sin sugerencia. Se valida aquí con la misma
// función del servidor (lib/contacts/sizes.ts) para mostrar los errores antes de guardar.
// «Guardar rangos» pide confirmación arriba (regla del dueño, 27-sep-2026;
// use-confirm.tsx) y avisa hacia arriba si hay cambios sin guardar.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { replaceSizeRanges } from "@/lib/actions/contact-qualification";
import { validateSizeRanges, type LineaCompuerta, type SizeRange } from "@/lib/contacts/sizes";
import type { AgentActionResult } from "@/lib/agente-ia/types";
import { useConfirm } from "./use-confirm";

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

// La acción truena si algo falla; aquí se vuelve un resultado para el pop-up.
async function saveRanges(ranges: SizeRange[]): Promise<AgentActionResult> {
  try {
    await replaceSizeRanges(ranges);
    return { ok: true };
  } catch {
    return { ok: false, message: "No se pudieron guardar los rangos." };
  }
}

export function SizeRangesSection({ initial, onDirtyChange }: { initial: SizeRange[]; onDirtyChange?: (dirty: boolean) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  // Lo último guardado, para saber si hay cambios sin guardar.
  const [savedKey, setSavedKey] = useState(() => JSON.stringify(toRanges(toRows(initial))));
  const confirm = useConfirm();

  const ranges = toRanges(rows);
  const numbersOk = rows.every((r) => /^\d+$/.test(r.minCm) && /^\d+$/.test(r.maxCm));
  const errors = numbersOk ? validateSizeRanges(ranges) : ["Mínimo y máximo deben ser números enteros de cm."];
  const dirty = JSON.stringify(ranges) !== savedKey;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    const toSave = ranges;
    confirm.ask({
      title: "¿Guardar los rangos de tallas?",
      body: "El tamaño sugerido de las entradas de todos los contactos se recalcula con estos rangos desde ahora.",
      confirmLabel: "Sí, guardar",
      pendingLabel: "Guardando…",
      done: "Listo: rangos guardados; las sugerencias de las entradas se recalcularon",
      run: () => saveRanges(toSave),
      onDone: () => {
        setSavedKey(JSON.stringify(toSave));
        router.refresh();
      },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Rangos de ancho (cm) por tamaño. Dentro de una línea no se pueden encimar; entre líneas sí (por ejemplo, 90 cm
        cabe en mini M y en estándar M). Los usa la sugerencia de tamaño de cada entrada en el Detalle del contacto.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {LINEAS.map((linea) => (
          <div key={linea.key} className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{linea.label}</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 font-medium">Tamaño</th>
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
                        <input aria-label="Tamaño" value={r.talla} onChange={(e) => update(r.key, { talla: e.target.value })} className={cell} />
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
                          aria-label={`Quitar ${r.talla || "tamaño"}`}
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
              + Agregar tamaño
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
      {confirm.error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={confirm.pending || errors.length > 0 || !dirty}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {confirm.pending ? "Guardando…" : "Guardar rangos"}
        </button>
        {dirty && <span className="text-xs text-muted-foreground">Cambios sin guardar.</span>}
      </div>
      {confirm.ui}
    </div>
  );
}
