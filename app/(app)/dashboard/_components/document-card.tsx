"use client";

// Tarjeta de documento estilo WhatsApp, compacta: miniatura de la 1ª página
// (PDF, cuando el worker ya la generó), ícono por extensión, nombre, páginas,
// tamaño y tipo. Presentacional: al hacer clic abre el visor.
import type { AttachmentView } from "@/lib/inbox/types";
import { extensionColor, fileExtension, formatBytes } from "./format";

export function DocumentCard({ attachment, onOpen }: { attachment: AttachmentView; onOpen: () => void }) {
  const ext = fileExtension(attachment.fileName, attachment.mimeType);
  const meta = [
    attachment.pageCount ? `${attachment.pageCount} ${attachment.pageCount === 1 ? "página" : "páginas"}` : null,
    formatBytes(attachment.sizeBytes) || null,
    ext.toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-64 max-w-full overflow-hidden rounded-lg border bg-card text-left text-foreground transition-colors hover:bg-muted"
    >
      {attachment.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-28 w-full border-b object-cover object-top"
        />
      )}
      <span className="flex items-center gap-2 px-2.5 py-2">
        <span
          className={`flex h-9 w-8 shrink-0 items-center justify-center rounded text-[9px] font-bold uppercase text-white ${extensionColor(ext)}`}
          aria-hidden="true"
        >
          {ext.slice(0, 4)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium">{attachment.fileName ?? "Documento"}</span>
          <span className="truncate text-[11px] text-muted-foreground">{meta}</span>
        </span>
      </span>
    </button>
  );
}
