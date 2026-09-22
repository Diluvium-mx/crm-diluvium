"use client";

// Visor emergente de adjuntos (Bandeja y pop-up de Contactos): imagen con zoom,
// PDF en el visor del navegador, y descargar para todo. Cierra con Esc, con la
// X o con clic fuera. Presentacional: recibe la vista del adjunto ya lista.
import { Download, Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AttachmentView } from "@/lib/inbox/types";
import { fileExtension } from "./format";

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

export function MediaViewer({ attachment, onClose }: { attachment: AttachmentView; onClose: () => void }) {
  const [zoom, setZoom] = useState(0);
  const isImage = attachment.kind === "image" || attachment.kind === "sticker";
  const isPdf = fileExtension(attachment.fileName, attachment.mimeType) === "pdf";
  const title = attachment.fileName ?? (isImage ? "Imagen" : "Documento");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (isImage && (event.key === "+" || event.key === "=")) setZoom((z) => Math.min(z + 1, ZOOM_STEPS.length - 1));
      if (isImage && event.key === "-") setZoom((z) => Math.max(z - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isImage, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 text-white"
      onClick={onClose}
    >
      <div className="flex items-center gap-2 px-4 py-3" onClick={(event) => event.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
        {isImage && (
          <>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(z - 1, 0))}
              disabled={zoom === 0}
              aria-label="Alejar"
              title="Alejar (−)"
              className="rounded p-2 hover:bg-white/10 disabled:opacity-40"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <span className="w-12 text-center text-xs tabular-nums">{Math.round(ZOOM_STEPS[zoom] * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(z + 1, ZOOM_STEPS.length - 1))}
              disabled={zoom === ZOOM_STEPS.length - 1}
              aria-label="Acercar"
              title="Acercar (+)"
              className="rounded p-2 hover:bg-white/10 disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </>
        )}
        <a
          href={attachment.downloadUrl}
          aria-label="Descargar"
          title="Descargar"
          className="rounded p-2 hover:bg-white/10"
        >
          <Download className="size-4" aria-hidden="true" />
        </a>
        <button type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)" className="rounded p-2 hover:bg-white/10">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" onClick={(event) => event.stopPropagation()}>
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={title}
            onClick={() => setZoom((z) => (z === 0 ? 2 : 0))}
            style={{ transform: `scale(${ZOOM_STEPS[zoom]})`, transformOrigin: "center" }}
            className={`max-h-full max-w-full object-contain transition-transform ${zoom === 0 ? "cursor-zoom-in" : "cursor-zoom-out"}`}
          />
        ) : isPdf ? (
          <iframe src={attachment.url} title={title} className="h-full w-full max-w-4xl rounded bg-white" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-white/80">Este tipo de archivo no se puede previsualizar.</p>
            <a href={attachment.downloadUrl} className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-white">
              Descargar {title}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
