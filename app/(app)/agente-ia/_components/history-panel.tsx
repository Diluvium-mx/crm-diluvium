"use client";

// Subpestaña "Historial" de la pestaña Agente IA (Bloque A, 28-sep-2026): quién cambió qué,
// antes → después y cuándo (hora de Mazatlán), lo más nuevo arriba. Filtros: tipo, fechas y
// las pausas automáticas (vendedor contestó, tope, asesor, vuelta sola; ocultas de fábrica).
// Se carga la primera vez que se abre la subpestaña y con cada filtro. "Ver cambios"
// (Bloque E) pide el detalle de UNA fila al abrirlo. Sin lógica de datos: solo llama a
// getChangeHistory y getChangeDiff.
import { useEffect, useState } from "react";
import { getChangeDiff, getChangeHistory, type ChangeDiffResult, type HistoryResult } from "@/lib/actions/historial";
import {
  formatMazatlan,
  HISTORY_LIMIT,
  HISTORY_TYPE_LABEL,
  HISTORY_TYPES,
  MANAGER_ONLY_TYPES,
  type HistoryRow,
  type HistoryType,
} from "@/lib/historial/labels";
import { HistoryDiff } from "./history-diff";

const fieldClass = "rounded border border-black/15 bg-background px-2 py-1 text-sm text-foreground dark:border-white/15";

type Filters = { type: HistoryType | ""; from: string; to: string; includeAuto: boolean };

function Row({ row }: { row: HistoryRow }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ChangeDiffResult | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      getChangeDiff(row.id)
        .catch((): ChangeDiffResult => ({ ok: false, message: "No se pudieron cargar los cambios." }))
        .then(setDetail);
    }
  };

  return (
    <li className="flex flex-col gap-0.5 border-b border-black/5 py-2 last:border-0 dark:border-white/5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-foreground/70">
        <span className="font-medium text-foreground">{row.who}</span>
        <time dateTime={row.at}>{formatMazatlan(new Date(row.at))}</time>
      </div>
      <p className="text-sm text-foreground">
        {row.what}
        <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-[11px] text-foreground/70 dark:bg-white/10">{HISTORY_TYPE_LABEL[row.type]}</span>
      </p>
      {(row.before !== null || row.after !== null) && (
        <p className="text-xs break-words text-foreground/70">
          <span>{row.before ?? "—"}</span>
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> cambió a </span>
          <span className="text-foreground">{row.after ?? "—"}</span>
        </p>
      )}
      {row.hasDetail && (
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="self-start rounded text-xs font-medium text-brand-navy underline-offset-2 hover:underline dark:text-sky-300"
          >
            {open ? "Ocultar cambios" : "Ver cambios"}
          </button>
          {open &&
            (!detail ? (
              <p className="text-xs text-foreground/70">Cargando cambios…</p>
            ) : !detail.ok ? (
              <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{detail.message}</p>
            ) : (
              <HistoryDiff diff={detail.diff} />
            ))}
        </div>
      )}
    </li>
  );
}

export function HistoryPanel({ active, canSeeSellers }: { active: boolean; canSeeSellers: boolean }) {
  const types = HISTORY_TYPES.filter((t) => canSeeSellers || !MANAGER_ONLY_TYPES.includes(t.id));
  const [filters, setFilters] = useState<Filters>({ type: "", from: "", to: "", includeAuto: false });
  const [loaded, setLoaded] = useState<{ key: string; result: HistoryResult } | null>(null);
  const key = JSON.stringify(filters);
  const result = loaded?.result ?? null;
  const loading = loaded?.key !== key;

  // Carga al abrir la subpestaña (cada vez: así se ve lo más nuevo) y con cada filtro;
  // solo cuenta la respuesta del último filtro.
  useEffect(() => {
    if (!active) return;
    let current = true;
    const f: Filters = JSON.parse(key);
    getChangeHistory({ type: f.type || null, from: f.from || null, to: f.to || null, includeAuto: f.includeAuto })
      .catch((): HistoryResult => ({ ok: false, message: "No se pudo cargar el historial." }))
      .then((r) => {
        if (current) setLoaded({ key, result: r });
      });
    return () => {
      current = false;
    };
  }, [active, key]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-foreground/70">
          Tipo
          <select value={filters.type} onChange={(e) => set({ type: e.target.value as HistoryType | "" })} className={fieldClass}>
            <option value="">Todos</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-foreground/70">
          Desde
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-foreground/70">
          Hasta
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} className={fieldClass} />
        </label>
        {(filters.type === "" || filters.type === "pausas") && (
          <label className="flex items-center gap-2 py-1 text-sm text-foreground">
            <input type="checkbox" checked={filters.includeAuto} onChange={(e) => set({ includeAuto: e.target.checked })} />
            Mostrar pausas automáticas (un vendedor contestó, tope de respuestas, pidió un asesor y vuelta sola)
          </label>
        )}
      </div>

      <div aria-live="polite" aria-busy={loading || undefined} className={loading && result ? "opacity-60" : undefined}>
        {!result ? (
          <p className="text-sm text-foreground/70">Cargando…</p>
        ) : !result.ok ? (
          <p className="border-l-2 border-brand-orange pl-2 text-sm text-foreground">{result.message}</p>
        ) : result.rows.length === 0 ? (
          <p className="text-sm text-foreground/70">No hay cambios con estos filtros.</p>
        ) : (
          <>
            <ul className="flex flex-col">
              {result.rows.map((r) => (
                <Row key={r.id} row={r} />
              ))}
            </ul>
            {result.truncated && <p className="pt-2 text-xs text-foreground/70">Se muestran los {HISTORY_LIMIT} cambios más recientes; usa las fechas para ver más atrás.</p>}
          </>
        )}
      </div>
    </div>
  );
}
