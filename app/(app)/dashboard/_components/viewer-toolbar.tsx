"use client";

// Barra azul flotante de abajo del visor de escritorio (opción B, 1-oct-2026): botones
// grandes con su nombre y una animación corta al pasar el mouse; al dar clic se hunden.
// Foto: Alejar · Zoom · Acercar | Ajustar · Girar · Descargar. PDF: Imprimir ·
// Descargar · Abrir aparte. Otro archivo: Descargar. Presentacional.
import type { ReactNode } from "react";
import { Download, ExternalLink, Printer, RotateCw, Scan, ZoomIn, ZoomOut } from "lucide-react";

const BUTTON =
  "group flex min-w-[78px] flex-col items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-[12.5px] text-white transition-[background-color,scale] duration-150 enabled:hover:bg-white/15 enabled:active:scale-92 disabled:cursor-default disabled:opacity-40";
const ICON = "size-6 transition-transform duration-200 motion-reduce:transition-none";

function ToolButton({ label, icon, onClick, disabled = false }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} data-no-glow="" className={BUTTON}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export type ViewerToolbarProps =
  | {
      type: "image";
      scale: number;
      canZoomIn: boolean;
      onZoomIn: () => void;
      onZoomOut: () => void;
      onFit: () => void;
      onRotate: () => void;
      onDownload: () => void;
    }
  | { type: "pdf"; printing: boolean; onPrint: () => void; onDownload: () => void; onOpenApart: () => void }
  | { type: "other"; onDownload: () => void };

export function ViewerToolbar(props: ViewerToolbarProps) {
  const download = (
    <ToolButton
      label="Descargar"
      onClick={props.onDownload}
      icon={<Download className={`${ICON} motion-safe:group-hover:translate-y-[3px]`} aria-hidden="true" />}
    />
  );
  return (
    <div className="flex items-stretch gap-1 rounded-[18px] bg-brand-navy p-1.5 shadow-lg">
      {props.type === "image" && (
        <>
          <ToolButton
            label="Alejar"
            onClick={props.onZoomOut}
            disabled={props.scale <= 1.001}
            icon={<ZoomOut className={`${ICON} ${props.scale > 1.001 ? "motion-safe:group-hover:scale-[1.18]" : ""}`} aria-hidden="true" />}
          />
          {/* Sin cursor de texto ni selección (pedido del dueño). */}
          <span className="flex min-w-16 cursor-default select-none flex-col items-center justify-center gap-1 text-[12.5px] text-white/85">
            <span className="text-[17px] tabular-nums text-white">{Math.round(props.scale * 100)} %</span>
            Zoom
          </span>
          <ToolButton
            label="Acercar"
            onClick={props.onZoomIn}
            disabled={!props.canZoomIn}
            icon={<ZoomIn className={`${ICON} ${props.canZoomIn ? "motion-safe:group-hover:scale-[1.18]" : ""}`} aria-hidden="true" />}
          />
          <span className="mx-1 my-2 w-px bg-white/25" aria-hidden="true" />
          <ToolButton label="Ajustar" onClick={props.onFit} icon={<Scan className={`${ICON} motion-safe:group-hover:scale-[1.22]`} aria-hidden="true" />} />
          <ToolButton label="Girar" onClick={props.onRotate} icon={<RotateCw className={`${ICON} motion-safe:group-hover:rotate-90`} aria-hidden="true" />} />
          {download}
        </>
      )}
      {props.type === "pdf" && (
        <>
          <ToolButton
            label={props.printing ? "Preparando…" : "Imprimir"}
            onClick={props.onPrint}
            disabled={props.printing}
            icon={<Printer className={`${ICON} motion-safe:group-hover:animate-[visor-brinco_0.45s_ease]`} aria-hidden="true" />}
          />
          {download}
          <ToolButton
            label="Abrir aparte"
            onClick={props.onOpenApart}
            icon={<ExternalLink className={`${ICON} motion-safe:group-hover:translate-x-[3px] motion-safe:group-hover:-translate-y-[3px]`} aria-hidden="true" />}
          />
        </>
      )}
      {props.type === "other" && download}
    </div>
  );
}
