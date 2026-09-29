"use client";

// ▶ Automatizaciones (SOLO versión móvil, 29-sep-2026): lista desplegable en la caja del
// chat —como la de ⚡ mensajes rápidos— con los workflows encendidos de Automatización.
// Cada renglón: miniatura cuadrada del archivo (imagen o primer cuadro del video) con el
// ícono de imagen/video/documento a media opacidad encima, el nombre y el mensaje
// predeterminado. Tocar un renglón manda exactamente lo mismo que escribir su comando
// (el texto y el archivo, en el orden configurado). En escritorio se sigue usando "/".
import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Video } from "lucide-react";
import { listWorkflowQuickSends, type WorkflowQuickSend } from "@/lib/actions/workflows";
import { CloseX } from "@/components/ui/close-x";

function Thumb({ media }: { media: WorkflowQuickSend["media"] }) {
  const src = media ? `/api/biblioteca/${media.assetId}` : null;
  const Icon = media?.kind === "video" ? Video : media?.kind === "image" ? ImageIcon : FileText;
  return (
    <span aria-hidden="true" className="relative size-12 shrink-0 overflow-hidden rounded-md border bg-muted">
      {/* <img>/<video> a propósito: la ruta redirige a una URL firmada del bucket privado. */}
      {src && media?.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      )}
      {src && media?.kind === "video" && <video src={src} muted playsInline preload="metadata" className="size-full bg-black object-cover" />}
      {/* Ícono del tipo de archivo, a media opacidad, dentro de la miniatura. */}
      <span className="absolute inset-0 flex items-center justify-center">
        <Icon className={`size-6 ${src ? "text-white opacity-50 drop-shadow" : "text-muted-foreground opacity-50"}`} />
      </span>
    </span>
  );
}

export function WorkflowPicker({ onRun, onClose }: { onRun: (command: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<WorkflowQuickSend[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listWorkflowQuickSends()
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch(() => {
        if (alive) setError("No se pudieron cargar las automatizaciones.");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    // Mismo tope que ⚡ y 📄: la mitad del chat (cqh).
    <div className="mb-2 flex max-h-[min(24rem,50cqh)] min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-md">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-sm font-semibold text-brand-navy dark:text-sky-300">▶ Automatizaciones</span>
        <CloseX always size="sm" label="Cerrar automatizaciones" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <p className="py-4 text-center text-sm text-brand-orange">{error}</p>
        ) : items === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando automatizaciones…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay automatizaciones encendidas con comando. Se encienden en la pestaña Automatización.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((w) => (
              <li key={w.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    onRun(w.command);
                    onClose();
                  }}
                  className="flex w-full min-w-0 items-center gap-3 rounded-md border px-2.5 py-2 text-left text-sm hover:border-brand-navy hover:bg-brand-navy/5"
                >
                  <Thumb media={w.media} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{w.name}</span>
                      <span className="shrink-0 rounded bg-brand-navy px-1.5 py-0.5 font-mono text-[11px] text-brand-white">{w.command}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {w.message || (w.media ? `Manda ${w.media.title}` : "Sin mensaje")}
                    </span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">▶</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
