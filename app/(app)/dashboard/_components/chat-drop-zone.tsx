"use client";

// Zona para soltar archivos sobre el chat (28-sep-2026): al arrastrar uno o
// varios archivos, TODO el chat (historial y caja de escribir) se cubre con una
// capa navy muy clara, borde punteado y el historial difuminado detrás. Con la
// ventana de 24 h cerrada o el canal archivado no hay capa (queda el aviso de
// siempre: solo plantilla) y soltar no abre el archivo en el navegador.
// La capa es la común (`FileDropZone`), la misma de la Biblioteca.
import type { ReactNode } from "react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { attachmentHelpText } from "@/lib/chat-attachments/rules";

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
  return (
    <FileDropZone enabled={enabled} onFiles={onFiles} onBrowse={onBrowse} helpText={attachmentHelpText()} testId="capa-adjuntos">
      {children}
    </FileDropZone>
  );
}
