"use client";

// Multimedia (📎 → Multimedia, 30-sep-2026): las fotos y los videos de la
// Biblioteca de Automatización —los MISMOS archivos, sin copia: lo que se sube,
// renombra o borra allá se ve aquí la próxima vez que se abre—. Tocar uno lo
// agrega a la vista previa de la caja (o lo quita); el número es el orden en
// que sale. No se sube nada: sale del bucket igual que en un workflow.
import { useEffect, useState } from "react";
import { ImagePlay, Image as ImageIcon, Video, X } from "lucide-react";
import { getMultimediaAssets } from "@/lib/actions/media-library";
import type { MediaAssetView } from "@/lib/media-library/service";
import { normalizeForSearch } from "@/lib/snippets/slash";
import { CloseX } from "@/components/ui/close-x";

type Filter = "todo" | "image" | "video";

function Thumb({ asset }: { asset: MediaAssetView }) {
  const src = `/api/biblioteca/${asset.id}`;
  const Icon = asset.kind === "video" ? Video : ImageIcon;
  return (
    <span aria-hidden="true" className="relative block aspect-square w-full overflow-hidden bg-muted">
      {/* <img>/<video> a propósito: la ruta redirige a una URL firmada del bucket privado. */}
      {asset.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        // #t=0.1: el navegador pinta el primer cuadro sin reproducir.
        <video src={`${src}#t=0.1`} muted playsInline preload="metadata" className="size-full bg-black object-cover" />
      )}
      <span className="absolute right-1 bottom-1 rounded bg-black/55 p-0.5 text-white">
        <Icon className="size-3.5" />
      </span>
    </span>
  );
}

export function MultimediaPicker({
  selected,
  onToggle,
  onClose,
}: {
  /** assetId → lugar (1, 2, 3…) en la vista previa de la caja. */
  selected: ReadonlyMap<string, number>;
  onToggle: (asset: MediaAssetView) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<MediaAssetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todo");

  useEffect(() => {
    let alive = true;
    getMultimediaAssets()
      .then((list) => {
        if (alive) setAssets(list);
      })
      .catch(() => {
        if (alive) setError("No se pudo abrir la Biblioteca.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const q = normalizeForSearch(query.trim());
  const visible = (assets ?? []).filter((a) => (filter === "todo" || a.kind === filter) && (!q || normalizeForSearch(a.title).includes(q)));
  const count = (kind: Filter) => (assets ?? []).filter((a) => kind === "todo" || a.kind === kind).length;
  const chips: { value: Filter; label: string }[] = [
    { value: "todo", label: "Todo" },
    { value: "image", label: "Fotos" },
    { value: "video", label: "Videos" },
  ];

  return (
    // Menos de la mitad del chat (cqh): abajo caben la vista previa y la caja para escribir, también en el celular.
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className="mb-2 flex max-h-[min(28rem,36cqh)] md:max-h-[min(28rem,45cqh)] min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-md"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-navy dark:text-sky-300">
          <ImagePlay className="size-4" aria-hidden="true" /> Multimedia
        </span>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">Fotos y videos de la Biblioteca · el número es el orden en que salen</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar multimedia"
          className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
        >
          <X className="size-4" aria-hidden="true" />
          Cerrar
        </button>
        <CloseX size="sm" label="Cerrar multimedia" onClick={onClose} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nombre"
          aria-label="Buscar en Multimedia"
          className="h-8 min-w-0 flex-1 basis-40 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
        />
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setFilter(chip.value)}
            aria-pressed={filter === chip.value}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === chip.value ? "border-brand-navy bg-brand-navy text-brand-white" : "text-muted-foreground hover:bg-brand-navy/10"
            }`}
          >
            {chip.label}
            {assets && <span className="ml-1 opacity-75">{count(chip.value)}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <p className="py-4 text-center text-sm text-brand-orange">{error}</p>
        ) : assets === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando la Biblioteca…</p>
        ) : assets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">La Biblioteca no tiene fotos ni videos. Se suben en Automatización › Biblioteca.</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Sin coincidencias.</p>
        ) : (
          // Columnas según el ancho del chat (no de la pantalla): con la lista y el Detalle abiertos queda angosto.
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
            {visible.map((asset) => {
              const place = selected.get(asset.id);
              return (
                <li key={asset.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onToggle(asset)}
                    aria-pressed={place !== undefined}
                    title={place !== undefined ? `Quitar ${asset.title}` : `Agregar ${asset.title}`}
                    className={`relative block w-full min-w-0 overflow-hidden rounded-md border text-left transition-colors ${
                      place !== undefined ? "border-brand-orange ring-2 ring-brand-orange" : "hover:border-brand-navy"
                    }`}
                  >
                    <Thumb asset={asset} />
                    {place !== undefined && (
                      <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-brand-orange text-[11px] font-semibold text-brand-white">
                        {place}
                      </span>
                    )}
                    <span className="block truncate px-1.5 pt-1 text-xs font-medium">{asset.title}</span>
                    <span className="block px-1.5 pb-1 text-[11px] text-muted-foreground">{asset.kind === "video" ? "Video" : "Foto"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
