"use client";

// Visor de adjuntos (Bandeja y pop-up del Embudo). En escritorio, el visor nuevo
// (1-oct-2026, opción B que eligió el dueño): recorre con ← → o deslizando todos los
// archivos del chat. En la versión móvil (< 768 px) sigue el de siempre.
import { useState } from "react";
import type { AttachmentView } from "@/lib/inbox/types";
import { useIsMobile } from "@/components/ui/use-media-query";
import { MediaViewerDesktop } from "./media-viewer-desktop";
import { MediaViewerMobile } from "./media-viewer-mobile";

export function MediaViewer({
  attachments,
  start,
  onClose,
}: {
  /** Los archivos del chat que abren el visor, del más viejo al más nuevo. */
  attachments: AttachmentView[];
  /** El que se abrió. */
  start: AttachmentView;
  onClose: () => void;
}) {
  // Se decide UNA vez, al abrir: al imprimir, Chrome mide la hoja como si fuera un celular
  // y el visor se cambiaba al móvil a media impresión (perdía el PDF y en qué archivo ibas).
  const isMobileNow = useIsMobile();
  const [isMobile] = useState(isMobileNow);
  if (isMobile) return <MediaViewerMobile attachment={start} onClose={onClose} />;
  return <MediaViewerDesktop attachments={attachments} start={start} onClose={onClose} />;
}
