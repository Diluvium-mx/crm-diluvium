"use client";

// Zona para soltar archivos sobre el chat (28-sep-2026): al arrastrar uno o
// varios archivos, TODO el chat (historial y caja de escribir) se cubre con una
// capa navy muy clara, borde punteado y el historial difuminado detrás. Con la
// ventana de 24 h cerrada o el canal archivado no hay capa (queda el aviso de
// siempre: solo plantilla) y soltar no abre el archivo en el navegador.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { CloudUpload } from "lucide-react";
import { attachmentHelpText } from "@/lib/chat-attachments/rules";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function ChatDropZone({
  enabled,
  onFiles,
  onBrowse,
  children,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  onBrowse: () => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave también saltan al pasar entre hijos: se cuenta la profundidad.
  const depth = useRef(0);

  // Arrastre cancelado (Esc) o soltado fuera: la capa nunca se queda pegada.
  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setOver(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        if (enabled) setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = enabled ? "copy" : "none";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        if (enabled) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
      {over && enabled && (
        <div className="absolute inset-0 z-30 bg-brand-navy/15 p-3 backdrop-blur-md dark:bg-sky-300/10" data-testid="capa-adjuntos">
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-brand-navy bg-brand-white/60 px-6 text-center dark:border-sky-300 dark:bg-background/60">
            <CloudUpload className="pointer-events-none size-10 text-brand-navy dark:text-sky-300" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">
              <button type="button" onClick={onBrowse} className="font-semibold text-brand-navy underline-offset-2 hover:underline dark:text-sky-300">
                Seleccionar
              </button>{" "}
              o arrastrar los archivos aquí
            </p>
            <p className="pointer-events-none max-w-md text-xs text-muted-foreground">{attachmentHelpText()}</p>
          </div>
        </div>
      )}
    </div>
  );
}
