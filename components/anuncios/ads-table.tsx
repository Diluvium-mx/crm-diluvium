"use client";

// Tabla de anuncios de Meta: SOLO presentación (no lee la base; recibe filas
// `AdRow`). Contrato en docs/ui-anuncios-tabla.md; los datos los conecta el
// bloque "Anuncios de Meta". Buscador sin acentos (lib/text/search.ts), filtro
// Activas/Todas, orden por cualquier encabezado (por defecto Clientes ↓),
// encabezado fijo con la tabla deslizándose por dentro (la página no), números a
// la derecha con tabular-nums, filas como tarjeta-enlace (data-link="card") y
// virtualizada (@tanstack/react-virtual) cuando pasa de 100 filas.
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronRight, ImageOff } from "lucide-react";
import { matchesSearch } from "@/lib/text/search";

export type AdStatus = "active" | "paused" | "unknown";

/** Una fila = un anuncio. Lo llena el bloque de Anuncios; la tabla solo lo pinta. */
export type AdRow = {
  /** Llave interna del anuncio (ruta /anuncios/[adKey]). */
  adKey: string;
  /** Id del anuncio en Meta. */
  adId: string;
  name: string;
  thumbnailUrl: string | null;
  /** Enlace al anuncio en Meta (Ads Manager); se abre en pestaña nueva. */
  metaUrl: string | null;
  campaignName: string;
  adsetName: string;
  status: AdStatus;
  /** Clics en el enlace (Métricas de anuncios); null = todavía no llega. */
  linkClicks: number | null;
  /** Clientes que escribieron por WhatsApp desde el anuncio. */
  clients: number;
  /** De esos, los que llegaron a la etapa Compra. */
  bought: number;
};

type SortKey = "name" | "campaignName" | "linkClicks" | "clients" | "bought" | "conversion";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const VIRTUALIZE_FROM = 100;
const ROW_HEIGHT = 64;

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; hint?: string }[] = [
  { key: "name", label: "Anuncio" },
  { key: "campaignName", label: "Campaña" },
  { key: "linkClicks", label: "Clics en el enlace", numeric: true },
  { key: "clients", label: "Clientes", numeric: true, hint: "Escribieron por WhatsApp" },
  { key: "bought", label: "Compraron", numeric: true, hint: "Llegaron a la etapa Compra" },
  { key: "conversion", label: "Conversión", numeric: true, hint: "Compraron ÷ clientes" },
];

const GRID = "grid grid-cols-[minmax(220px,2fr)_minmax(180px,1.5fr)_repeat(4,minmax(96px,1fr))] items-center gap-3";
const pct = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("es-MX");

export function conversionOf(row: AdRow): number | null {
  return row.clients > 0 ? row.bought / row.clients : null;
}

function valueOf(row: AdRow, key: SortKey): string | number | null {
  if (key === "conversion") return conversionOf(row);
  return row[key];
}

// Nulos siempre al final, sin importar la dirección.
function compare(a: AdRow, b: AdRow, sort: Sort): number {
  const va = valueOf(a, sort.key);
  const vb = valueOf(b, sort.key);
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  const base = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es");
  return sort.dir === "asc" ? base : -base;
}

export function sortAndFilterRows(rows: readonly AdRow[], opts: { query: string; onlyActive: boolean; sort: Sort }): AdRow[] {
  return rows
    .filter((r) => (!opts.onlyActive || r.status === "active") && matchesSearch(`${r.name} ${r.campaignName} ${r.adsetName}`, opts.query))
    .sort((a, b) => compare(a, b, opts.sort));
}

function StatusDot({ status }: { status: AdStatus }) {
  const label = status === "active" ? "Activa" : status === "paused" ? "Pausada" : "Sin estado";
  const color = status === "active" ? "bg-emerald-500" : status === "paused" ? "bg-muted-foreground/60" : "bg-muted-foreground/30";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Row({ row, style }: { row: AdRow; style?: React.CSSProperties }) {
  const conversion = conversionOf(row);
  return (
    // La fila entera es un enlace (capa absoluta): un <a> no puede ir dentro de
    // otro <a>, así que el ↗ a Meta y el aviso de "—" quedan por encima (z-10).
    <div role="row" style={style} className="absolute inset-x-0 top-0 px-2 py-1">
      <div data-link="card" className={`${GRID} relative h-14 rounded-md border bg-card px-3 text-sm`}>
        <Link href={`/anuncios/${encodeURIComponent(row.adKey)}`} aria-label={`Abrir el anuncio «${row.name}»`} className="absolute inset-0 rounded-md" />
        <span role="cell" className="flex min-w-0 items-center gap-2">
          {row.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.thumbnailUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
          ) : (
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
              <ImageOff className="size-4" />
            </span>
          )}
          <span className="truncate font-medium">{row.name}</span>
          {row.metaUrl && (
            <a
              href={row.metaUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Ver «${row.name}» en Meta (pestaña nueva)`}
              title="Ver en Meta"
              className="relative z-10 ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          )}
        </span>
        <span role="cell" className="flex min-w-0 flex-col">
          <span className="truncate">{row.campaignName}</span>
          <span className="truncate text-xs text-muted-foreground">{row.adsetName}</span>
          <StatusDot status={row.status} />
        </span>
        <span role="cell" className="text-right tabular-nums">
          {row.linkClicks === null ? (
            <span className="relative z-10 cursor-help text-muted-foreground" title="Llega con Métricas de anuncios">
              —
            </span>
          ) : (
            num.format(row.linkClicks)
          )}
        </span>
        <span role="cell" className="text-right tabular-nums">{num.format(row.clients)}</span>
        <span role="cell" className="text-right tabular-nums">{num.format(row.bought)}</span>
        <span role="cell" className="flex items-center justify-end gap-1 text-right tabular-nums">
          {conversion === null ? <span className="text-muted-foreground">—</span> : pct.format(conversion)}
          <ChevronRight data-link-arrow="" className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

export function AdsTable({
  rows,
  loading = false,
  emptyMessage = "Todavía no hay anuncios con clientes.",
  className = "",
}: {
  rows: readonly AdRow[];
  loading?: boolean;
  emptyMessage?: string;
  /** Alto lo pone el padre (p. ej. h-[calc(100dvh-14rem)]): la tabla se desliza por dentro. */
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [sort, setSort] = useState<Sort>({ key: "clients", dir: "desc" });
  const scrollRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => sortAndFilterRows(rows, { query, onlyActive, sort }), [rows, query, onlyActive, sort]);
  const virtual = shown.length > VIRTUALIZE_FROM;
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    enabled: virtual,
  });

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "campaignName" ? "asc" : "desc" }));
  }

  const items = virtual ? virtualizer.getVirtualItems().map((v) => ({ row: shown[v.index], top: v.start })) : shown.map((row, i) => ({ row, top: i * ROW_HEIGHT }));
  const totalHeight = shown.length * ROW_HEIGHT;

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar anuncio, campaña o conjunto…"
          aria-label="Buscar anuncio, campaña o conjunto"
          className="min-w-56 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
        />
        <div role="radiogroup" aria-label="Filtrar anuncios" className="flex rounded-lg bg-muted p-1 text-sm">
          {[
            { value: true, label: "Activas" },
            { value: false, label: "Todas" },
          ].map((f) => (
            <button
              key={f.label}
              type="button"
              role="radio"
              aria-checked={onlyActive === f.value}
              onClick={() => setOnlyActive(f.value)}
              className={`rounded-md px-3 py-1 ${onlyActive === f.value ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{shown.length} de {rows.length}</span>
      </div>

      <div role="table" aria-label="Anuncios" aria-rowcount={shown.length} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <div role="row" className={`${GRID} shrink-0 border-b bg-muted/60 px-5 py-2 text-xs font-medium text-muted-foreground`}>
          {COLUMNS.map((c) => {
            const active = sort.key === c.key;
            const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
            return (
              <button
                key={c.key}
                type="button"
                role="columnheader"
                aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                title={c.hint}
                onClick={() => toggleSort(c.key)}
                className={`flex items-center gap-1 rounded px-1 py-0.5 ${c.numeric ? "justify-end text-right" : "text-left"} ${active ? "text-foreground" : ""}`}
              >
                {c.label}
                <Arrow className={`size-3 transition-opacity ${active ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Cargando anuncios…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Ningún anuncio coincide con la búsqueda o el filtro.</p>
          ) : (
            <div role="rowgroup" className="relative" style={{ height: virtual ? virtualizer.getTotalSize() : totalHeight }}>
              {items.map(({ row, top }) => (
                <Row key={row.adKey} row={row} style={{ transform: `translateY(${top}px)` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
