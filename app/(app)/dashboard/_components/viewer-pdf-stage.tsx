"use client";

// Un PDF dentro del visor de escritorio: sus páginas dibujadas por pdf.js, una debajo
// de otra. Las verticales (cotizaciones) van a lo ancho; las cuadradas o acostadas se
// ven completas sin bajar. Se baja con la rueda, con dos dedos o arrastrando hacia
// arriba con un dedo (lo hace media-viewer-desktop.tsx con `scrollRef`).
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { Download, ExternalLink } from "lucide-react";
import type { RenderTask } from "pdfjs-dist";
import { pdfPageFitsScreen } from "@/lib/inbox/viewer";
import { getPdf } from "./viewer-pdf-document";

// Ancho mínimo con el que se dibuja una página (en pantallas chicas se ve igual de nítida).
const MIN_RENDER_CSS_PX = 600;
const MAX_SIDE_PX = 4096;

export const ViewerPdfStage = memo(function ViewerPdfStage({
  url,
  downloadUrl,
  scrollRef,
}: {
  url: string;
  downloadUrl: string;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const columnRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const pdf = await getPdf(url);
        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          const one = page.getViewport({ scale: 1 });
          const cssWidth = Math.max(column.clientWidth, MIN_RENDER_CSS_PX);
          const scale = Math.min((cssWidth * (window.devicePixelRatio || 1)) / one.width, MAX_SIDE_PX / Math.max(one.width, one.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "mx-auto block h-auto w-full rounded bg-white";
          canvas.style.aspectRatio = `${one.width} / ${one.height}`;
          if (pdfPageFitsScreen(one.width, one.height)) {
            canvas.style.maxWidth = `calc((100cqh - 24px) * ${one.width / one.height})`;
          }
          column.append(canvas);
          task = page.render({ canvas, viewport });
          await task.promise;
          task = null;
          if (n === 1 && !cancelled) setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      column.replaceChildren();
    };
  }, [url]);

  return (
    <div ref={scrollRef} className="absolute inset-0 cursor-grab overflow-x-hidden overflow-y-auto overscroll-contain py-3 [container-type:size]">
      <div ref={columnRef} className="mx-auto flex w-[min(900px,calc(100%-170px))] flex-col gap-3.5" />
      {state === "loading" && (
        <p className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-[rgba(10,15,24,0.92)] px-6 py-4 text-[15px] text-white/85">Cargando PDF…</p>
      )}
      {state === "error" && (
        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 rounded-2xl bg-[rgba(10,15,24,0.92)] px-10 py-8 text-center shadow-xl">
          <p className="text-[15px] text-white/85">No se pudo mostrar este PDF.</p>
          <div className="flex gap-3">
            <a href={downloadUrl} data-no-glow="" className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-orange px-5 font-semibold text-white hover:bg-brand-orange-light">
              <Download className="size-5" aria-hidden="true" />
              Descargar
            </a>
            <a href={url} target="_blank" rel="noopener" data-no-glow="" className="inline-flex h-12 items-center gap-2 rounded-xl bg-white/15 px-5 font-semibold text-white hover:bg-white/25">
              <ExternalLink className="size-5" aria-hidden="true" />
              Abrir aparte
            </a>
          </div>
        </div>
      )}
    </div>
  );
});
