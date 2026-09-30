"use client";

// Vista previa de los adjuntos arriba de la caja de escribir (28-sep-2026): por
// archivo, miniatura (foto o primer cuadro del video) o ícono del tipo, nombre,
// peso, barra de subida y ✕ para quitarlo. Solo muestra: la lógica vive en
// use-chat-attachments.ts. Los de la Biblioteca (Multimedia) no se suben: sin
// barra, con su número de orden (el mismo que se ve en Multimedia).
import { FileSpreadsheet, FileText, Presentation, X } from "lucide-react";
import { extensionOf, formatBytes } from "@/lib/chat-attachments/rules";
import type { AttachmentItem } from "./use-chat-attachments";

function DocIcon({ name }: { name: string }) {
  const ext = extensionOf(name);
  const Icon = ext === "xls" || ext === "xlsx" ? FileSpreadsheet : ext === "ppt" || ext === "pptx" ? Presentation : FileText;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-0.5 bg-brand-navy/10 text-brand-navy dark:text-sky-300">
      <Icon className="size-6" aria-hidden="true" />
      <span className="text-[9px] font-semibold uppercase">{ext || "doc"}</span>
    </div>
  );
}

function Thumb({ item }: { item: AttachmentItem }) {
  // Rechazado (p. ej. un PDF renombrado a .jpg): sin miniatura rota.
  if (item.state === "error") return <div className="flex size-full items-center justify-center bg-red-500/10 text-lg text-red-600">⚠</div>;
  if (item.posterUrl) {
    // Miniatura de la Biblioteca (foto o primer cuadro del video): sin descargar el archivo.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.posterUrl} alt="" className="size-full object-cover" />;
  }
  if (item.previewUrl && item.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.previewUrl} alt="" className="size-full object-cover" />;
  }
  if (item.previewUrl && item.kind === "video") {
    // #t=0.1: el navegador pinta el primer cuadro sin reproducir.
    return <video src={`${item.previewUrl}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />;
  }
  if (item.kind === "image") return <div className="flex size-full items-center justify-center bg-brand-navy/10 text-[10px] text-muted-foreground">Foto</div>;
  return <DocIcon name={item.name} />;
}

function statusLine(item: AttachmentItem): string {
  if (item.assetId) return `Biblioteca · ${formatBytes(item.size)}`;
  if (item.state === "converting") return "Convirtiendo a JPG…";
  if (item.state === "uploading") return `Subiendo… ${Math.round(item.progress * 100)}%`;
  if (item.state === "ready") return formatBytes(item.size);
  return item.error ?? "No se pudo subir.";
}

export function AttachmentTray({ items, onRemove }: { items: AttachmentItem[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    // Celular: hacia abajo, con tope de dos renglones (se desliza por dentro, nunca de lado): con
    // varios archivos, la caja para escribir y Enviar no se salen de la pantalla.
    <ul aria-label="Archivos adjuntos" className="mb-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto pb-1 md:max-h-none md:flex-nowrap md:overflow-x-auto">
      {items.map((item, index) => (
        <li
          key={item.id}
          className={`relative flex w-60 shrink-0 items-center gap-2 rounded-lg border bg-background p-1.5 pr-7 ${
            item.state === "error" ? "border-red-400/70" : ""
          }`}
        >
          <div className="relative size-12 shrink-0 overflow-hidden rounded-md border">
            <Thumb item={item} />
            {items.length > 1 && (
              <span
                aria-label={`Sale en el lugar ${index + 1}`}
                className="absolute top-0.5 left-0.5 flex size-4 items-center justify-center rounded-full bg-brand-orange text-[10px] font-semibold text-brand-white"
              >
                {index + 1}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" title={item.name}>
              {item.name}
            </p>
            <p className={`text-[11px] ${item.state === "error" ? "line-clamp-3 text-red-600 dark:text-red-400" : "truncate text-muted-foreground"}`} title={statusLine(item)}>
              {item.state === "ready" || item.state === "error" ? statusLine(item) : `${formatBytes(item.size)} · ${statusLine(item)}`}
            </p>
            {item.state !== "error" && !item.assetId && (
              <div
                className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`Subida de ${item.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.progress * 100)}
              >
                <div
                  className={`h-full rounded-full transition-[width] ${item.state === "ready" ? "bg-emerald-500" : "bg-brand-navy dark:bg-sky-300"}`}
                  style={{ width: `${Math.round((item.state === "ready" ? 1 : item.progress) * 100)}%` }}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Quitar ${item.name}`}
            title="Quitar"
            className="absolute top-1 right-1 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
