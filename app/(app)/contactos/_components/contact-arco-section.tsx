"use client";

// «Datos personales» al final del Detalle del contacto (derechos ARCO, 7-oct-2026), discreta: dos
// acciones de texto, «Exportar datos» (descarga el zip: datos.json, chat.txt y los archivos que
// mandó el cliente) y «Borrar contacto» (rojo). Las dos abren primero su ventana de aviso (26-oct-2026,
// pedido del dueño; antes Exportar descargaba con el clic): la de Exportar dice qué lleva el zip y la de
// Borrar pide escribir BORRAR. Todos los roles. Sin lógica de datos.
import { useState } from "react";
import { DeleteContactDialog } from "./delete-contact-dialog";
import { ExportContactDialog } from "./export-contact-dialog";

export function ContactArcoSection({
  contactId,
  contactName,
  onDeleted,
}: {
  contactId: string;
  contactName: string;
  /** Ya se borró: el tablero lo quita y cierra este Detalle. */
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState<"exportar" | "borrar" | null>(null);

  return (
    <section className="space-y-1.5 border-t pt-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Datos personales</h3>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button type="button" data-link="text" data-no-glow="" onClick={() => setOpen("exportar")}>
          Exportar datos
        </button>
        <button
          type="button"
          data-no-glow=""
          onClick={() => setOpen("borrar")}
          className="text-red-600 underline-offset-2 hover:underline focus-visible:underline dark:text-red-400"
        >
          Borrar contacto
        </button>
      </div>

      {open === "exportar" && <ExportContactDialog contactId={contactId} contactName={contactName} onClose={() => setOpen(null)} />}

      {open === "borrar" && (
        <DeleteContactDialog
          contactId={contactId}
          contactName={contactName}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null);
            onDeleted();
          }}
        />
      )}
    </section>
  );
}
