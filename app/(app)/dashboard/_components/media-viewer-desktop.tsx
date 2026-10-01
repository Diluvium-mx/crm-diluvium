"use client";

// Visor de adjuntos de ESCRITORIO (1-oct-2026; opción B que eligió el dueño probando
// la página de prueba). Fondo del CRM visible al 65 %; arriba el nombre, la píldora
// azul «n de m» y la ✕ naranja (roja al pasar el mouse); a los lados las flechas
// naranjas; abajo la barra azul (viewer-toolbar.tsx). Recorre TODOS los archivos del
// chat: flechas, teclas ← →, un dedo en el Magic Mouse (rueda horizontal) o clic,
// arrastrar y soltar; en el primero/último cede 40 px y regresa. Foto: lupa (clic =
// 200 % donde se hizo clic; otro clic = 100 %), la rueda NUNCA hace zoom (en 200 %
// mueve la foto), Girar y descargar girada. PDF dibujado por pdf.js, Imprimir página
// por página y Abrir aparte. La lógica pura vive en lib/inbox/viewer.ts.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, X } from "lucide-react";
import type { AttachmentView } from "@/lib/inbox/types";
import {
  clampPan,
  dragDecision,
  dragOffset,
  fitImage,
  IMAGE_VIEW_START,
  LUPA_ZOOM,
  MAX_ZOOM,
  quarterTurns,
  stepZoom,
  WHEEL_SWIPE_START,
  wheelSwipe,
  zoomAt,
  type ImageView,
  type Size,
} from "@/lib/inbox/viewer";
import { ViewerToolbar } from "./viewer-toolbar";
import { ViewerPdfStage } from "./viewer-pdf-stage";
import { getPdf, releasePdfs } from "./viewer-pdf-document";
import { printPdf } from "./viewer-print";
import { downloadRotatedImage } from "./viewer-rotated-download";

// Si la rueda deja de llegar este tiempo sin cambiar de archivo, el archivo regresa a su lugar.
const WHEEL_IDLE_MS = 180;
// Movimiento mínimo para que un clic se vuelva arrastre.
const DRAG_START_PX = 6;

type Drag = {
  x: number;
  y: number;
  start: ImageView;
  axis: null | "pan" | "x" | "y";
  onImage: boolean;
  scrollTop: number;
};

function viewKind(attachment: AttachmentView): "image" | "pdf" | "other" {
  if (attachment.preview === "image") return "image";
  if (attachment.preview === "pdf") return "pdf";
  return "other";
}

function titleOf(attachment: AttachmentView): string {
  if (attachment.fileName) return attachment.fileName;
  if (attachment.kind === "sticker") return "Sticker";
  return attachment.preview === "image" ? "Imagen" : "Documento";
}

function startDownload(href: string): void {
  const link = document.createElement("a");
  link.href = href;
  document.body.append(link);
  link.click();
  link.remove();
}

export function MediaViewerDesktop({
  attachments,
  start,
  onClose,
}: {
  attachments: AttachmentView[];
  start: AttachmentView;
  onClose: () => void;
}) {
  // Si el archivo abierto ya no está en la lista (llegó un mensaje y se recargó), se recorre solo él.
  const list = useMemo(() => (attachments.some((a) => a.url === start.url) ? attachments : [start]), [attachments, start]);
  const [currentUrl, setCurrentUrl] = useState(start.url);
  const found = list.findIndex((a) => a.url === currentUrl);
  const index = found >= 0 ? found : 0;
  const current = found >= 0 ? list[found] : start;
  const kind = viewKind(current);
  const [enterDir, setEnterDir] = useState<1 | -1 | 0>(0);

  const [view, setView] = useState<ImageView>(IMAGE_VIEW_START);
  const [animate, setAnimate] = useState(false);
  const [natural, setNatural] = useState<Size | null>(null);
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pdfScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const wheelRef = useRef(WHEEL_SWIPE_START);
  const wheelIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fit = natural ? fitImage(natural, stage, view.rot) : null;
  const canGo = useCallback((dir: 1 | -1) => index + dir >= 0 && index + dir < list.length, [index, list.length]);

  // Desplazamiento del archivo mientras se desliza (imperativo: va a 60 cuadros por segundo).
  const applySwipe = useCallback((px: number, animated: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.animation = "none";
    el.style.transition = animated ? "translate 0.2s ease" : "none";
    el.style.translate = px ? `${px}px 0` : "";
  }, []);
  // Primer/último archivo: se muestran los 40 px y regresa de inmediato (sin esperar un cuadro).
  const bounce = useCallback(
    (px: number) => {
      applySwipe(px, false);
      if (contentRef.current) void contentRef.current.offsetWidth;
      applySwipe(0, true);
    },
    [applySwipe],
  );

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = list[index + dir];
      if (!next) {
        applySwipe(0, true);
        return;
      }
      setEnterDir(dir);
      setCurrentUrl(next.url);
      setView(IMAGE_VIEW_START);
      setAnimate(false);
      setNatural(null);
      setImageFailed(false);
      setNotice(null);
    },
    [applySwipe, index, list],
  );

  const setImageView = useCallback(
    (next: (v: ImageView) => ImageView, animated: boolean) => {
      setAnimate(animated);
      setView((v) => clampPan(next(v), fit?.base ?? { w: 0, h: 0 }, stage));
    },
    [fit?.base, stage],
  );

  // Tamaño del área del archivo (para ajustar la foto y limitar el desplazamiento).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Con el visor abierto, deslizar a los lados no hace «Atrás» en Chrome; al cerrar se liberan los PDF.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = "none";
    return () => {
      root.style.overscrollBehaviorX = previous;
      releasePdfs();
      if (wheelIdleRef.current) clearTimeout(wheelIdleRef.current);
    };
  }, []);

  // Los avisos (descarga o impresión fallida) se quitan solos.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Lo último de cada render, para los listeners nativos (rueda y teclado).
  const latest = useRef({ kind, view, canGo, go, bounce, applySwipe, setImageView, onClose, stage });
  useLayoutEffect(() => {
    latest.current = { kind, view, canGo, go, bounce, applySwipe, setImageView, onClose, stage };
  });

  // Rueda: nunca hace zoom. Foto en 200 % = moverla. PDF hacia arriba/abajo = bajar páginas
  // (lo hace el navegador). A los lados (un dedo en el Magic Mouse) = cambiar de archivo.
  useEffect(() => {
    const el = stageRef.current?.parentElement;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const s = latest.current;
      const k = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? s.stage.h : 1;
      const dx = event.deltaX * k;
      const dy = event.deltaY * k;
      if (s.kind === "image" && s.view.scale > 1) {
        event.preventDefault();
        s.setImageView((v) => ({ ...v, tx: v.tx - dx, ty: v.ty - dy }), false);
        return;
      }
      if (Math.abs(dx) <= Math.abs(dy)) {
        if (s.kind !== "pdf" || event.ctrlKey) event.preventDefault();
        return;
      }
      event.preventDefault();
      const { state, action } = wheelSwipe(wheelRef.current, dx, performance.now(), s.canGo);
      wheelRef.current = state;
      if (wheelIdleRef.current) clearTimeout(wheelIdleRef.current);
      if (action.type === "go") s.go(action.dir);
      else if (action.type === "bounce") s.bounce(action.px);
      else if (action.type === "follow") s.applySwipe(action.px, false);
      if (action.type === "follow") {
        wheelIdleRef.current = setTimeout(() => {
          if (!wheelRef.current.locked) {
            wheelRef.current = { ...wheelRef.current, acc: 0 };
            latest.current.applySwipe(0, true);
          }
        }, WHEEL_IDLE_MS);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Teclado en CAPTURA: el visor está encima de otros diálogos (la ficha del Embudo
  // escucha Esc en document) y sus teclas son SOLO del visor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const s = latest.current;
      const keys = ["Escape", "ArrowLeft", "ArrowRight", "+", "=", "-", "0", "r", "R"];
      if (!keys.includes(event.key)) return;
      const imageOnly = !["Escape", "ArrowLeft", "ArrowRight"].includes(event.key);
      if (imageOnly && s.kind !== "image") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (event.key === "Escape") s.onClose();
      else if (event.key === "ArrowLeft") s.go(-1);
      else if (event.key === "ArrowRight") s.go(1);
      else if (event.key === "+" || event.key === "=") s.setImageView((v) => zoomAt(v, stepZoom(v.scale, 1)), true);
      else if (event.key === "-") s.setImageView((v) => zoomAt(v, stepZoom(v.scale, -1)), true);
      else if (event.key === "0") s.setImageView((v) => zoomAt(v, 1), true);
      else s.setImageView((v) => ({ ...IMAGE_VIEW_START, rot: v.rot + 90 }), true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Un clic sin mover: la lupa. Arrastre: mover la foto ampliada, cambiar de archivo
  // (a los lados) o bajar el PDF (hacia arriba/abajo).
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("a, button")) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      start: view,
      axis: null,
      onImage: (event.target as Element).closest("[data-visor-foto]") !== null,
      scrollTop: pdfScrollRef.current?.scrollTop ?? 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_START_PX) return;
      drag.axis = kind === "image" && drag.start.scale > 1 ? "pan" : Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      setDragging(true);
    }
    if (drag.axis === "pan") setImageView(() => ({ ...drag.start, tx: drag.start.tx + dx, ty: drag.start.ty + dy }), false);
    else if (drag.axis === "x") applySwipe(dragOffset(dx, canGo), false);
    else if (drag.axis === "y" && pdfScrollRef.current) pdfScrollRef.current.scrollTop = drag.scrollTop - dy;
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    setDragging(false);
    if (cancelled) {
      applySwipe(0, true);
      return;
    }
    if (!drag.axis) {
      if (!drag.onImage || kind !== "image") return;
      const rect = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - (rect.left + rect.width / 2);
      const py = event.clientY - (rect.top + rect.height / 2);
      // Lupa «+»: 200 % donde se hizo clic. Lupa «−»: regresa a 100 %.
      setImageView((v) => (v.scale > 1 ? zoomAt(v, 1) : zoomAt(v, LUPA_ZOOM, px, py)), true);
      return;
    }
    if (drag.axis !== "x") return;
    const dir = dragDecision(event.clientX - drag.x, canGo);
    if (dir) go(dir);
    else applySwipe(0, true);
  };

  const download = async () => {
    if (kind === "image" && quarterTurns(view.rot) !== 0) {
      try {
        await downloadRotatedImage(current, view.rot);
      } catch {
        setNotice("No se pudo descargar la foto girada. Intenta de nuevo.");
      }
      return;
    }
    startDownload(current.downloadUrl);
  };

  const print = async () => {
    setPrinting(true);
    try {
      await printPdf(await getPdf(current.url));
    } catch {
      setNotice("No se pudo preparar la impresión. Usa «Abrir aparte» para imprimirlo desde Chrome.");
    } finally {
      setPrinting(false);
    }
  };

  const title = titleOf(current);
  const imgCursor = dragging ? "grabbing" : view.scale > 1 ? "zoom-out" : "zoom-in";

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-[rgba(10,15,24,0.65)] text-white">
      {/* Arriba: nombre del archivo, «n de m» y Cerrar. */}
      <div className="flex min-h-[68px] items-center gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="truncate text-[19px] font-semibold [text-shadow:0_1px_4px_rgba(0,0,0,0.7)]" title={title}>
            {title}
          </span>
          {/* Sin cursor de texto ni selección (pedido del dueño). */}
          <span className="shrink-0 cursor-default select-none rounded-full border border-white/20 bg-brand-navy px-3.5 py-1 text-[15px] font-semibold">
            {index + 1} de {list.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar (Esc)"
          title="Cerrar (Esc)"
          data-no-glow=""
          className="group flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-orange transition-[background-color,scale] duration-200 hover:bg-[#dc2626] active:scale-92 active:bg-[#b91c1c]"
        >
          <X className="size-[26px] transition-transform duration-200 group-hover:scale-[1.12] motion-reduce:transition-none" strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>

      {/* El archivo. */}
      <div
        ref={stageRef}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${dragging ? "cursor-grabbing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
      >
        <div
          key={current.url}
          ref={contentRef}
          className={`absolute inset-0 ${enterDir > 0 ? "animate-[visor-entra-der_0.22s_ease-out]" : enterDir < 0 ? "animate-[visor-entra-izq_0.22s_ease-out]" : ""} motion-reduce:animate-none`}
        >
          {kind === "image" && !imageFailed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              data-visor-foto=""
              src={current.url}
              alt={title}
              draggable={false}
              // Si ya estaba en caché, puede haber cargado antes de escuchar «load».
              ref={(img) => {
                if (img?.complete && img.naturalWidth && !natural) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
              onError={() => setImageFailed(true)}
              className="absolute top-1/2 left-1/2 max-w-none"
              style={{
                width: fit ? fit.width : undefined,
                height: fit ? fit.height : undefined,
                visibility: fit ? "visible" : "hidden",
                cursor: imgCursor,
                transition: animate ? "transform 0.2s ease" : "none",
                transform: `translate(calc(-50% + ${view.tx}px), calc(-50% + ${view.ty}px)) rotate(${view.rot}deg) scale(${view.scale})`,
              }}
            />
          )}
          {kind === "pdf" && <ViewerPdfStage url={current.url} downloadUrl={current.downloadUrl} scrollRef={pdfScrollRef} />}
          {kind === "image" && imageFailed && (
            <p className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-[rgba(10,15,24,0.92)] px-6 py-4 text-[15px] text-white/85">
              No se pudo mostrar la imagen. Puedes descargarla.
            </p>
          )}
          {kind === "other" && (
            // Recuadro oscuro: con el CRM visible detrás (65 %), el texto suelto no se leía bien.
            <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 rounded-2xl bg-[rgba(10,15,24,0.92)] px-10 py-8 text-center shadow-xl">
              <span className="flex size-20 items-center justify-center rounded-2xl bg-white/10">
                <FileText className="size-10" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <p className="text-[15px] text-white/85">Este tipo de archivo no se puede ver aquí.</p>
              <button
                type="button"
                onClick={() => startDownload(current.downloadUrl)}
                data-no-glow=""
                className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-brand-orange px-6 text-base font-semibold hover:bg-brand-orange-light active:scale-92"
              >
                Descargar {title}
              </button>
            </div>
          )}
        </div>

        {/* Flechas naranjas: se adelantan hacia su lado al pasar el mouse. */}
        {index > 0 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Anterior (←)"
            title="Anterior (←)"
            data-no-glow=""
            className="group absolute top-1/2 left-[18px] z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full bg-brand-orange shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-[background-color,scale] duration-150 hover:bg-brand-orange-light active:scale-92"
          >
            <ChevronLeft className="size-[30px] transition-transform duration-200 group-hover:-translate-x-1 motion-reduce:transition-none" strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
        {index < list.length - 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Siguiente (→)"
            title="Siguiente (→)"
            data-no-glow=""
            className="group absolute top-1/2 right-[18px] z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full bg-brand-orange shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-[background-color,scale] duration-150 hover:bg-brand-orange-light active:scale-92"
          >
            <ChevronRight className="size-[30px] transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Abajo: la barra azul. */}
      <div className="flex flex-col items-center gap-2 px-4 pt-2 pb-4">
        {notice && <p className="rounded-lg bg-black/60 px-3 py-1.5 text-sm text-white">{notice}</p>}
        {kind === "image" ? (
          <ViewerToolbar
            type="image"
            scale={view.scale}
            canZoomIn={view.scale < MAX_ZOOM - 0.001}
            onZoomIn={() => setImageView((v) => zoomAt(v, stepZoom(v.scale, 1)), true)}
            onZoomOut={() => setImageView((v) => zoomAt(v, stepZoom(v.scale, -1)), true)}
            onFit={() => setImageView((v) => zoomAt(v, 1), true)}
            onRotate={() => setImageView((v) => ({ ...IMAGE_VIEW_START, rot: v.rot + 90 }), true)}
            onDownload={() => void download()}
          />
        ) : kind === "pdf" ? (
          <ViewerToolbar
            type="pdf"
            printing={printing}
            onPrint={() => void print()}
            onDownload={() => void download()}
            onOpenApart={() => window.open(current.url, "_blank", "noopener")}
          />
        ) : (
          <ViewerToolbar type="other" onDownload={() => void download()} />
        )}
      </div>
    </div>
  );
}
