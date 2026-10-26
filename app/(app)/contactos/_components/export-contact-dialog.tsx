"use client";

// Ventana «Exportar datos» (derechos ARCO; aviso antes de descargar pedido por el dueño el 26-oct-2026; antes
// la descarga empezaba con el clic). Dice QUÉ lleva el zip (datos y chat del CRM y los archivos que mandó el
// cliente, con su peso) y que trae datos personales; «Exportar datos» lo descarga. Si los archivos pasan el
// tope (200 MB), lo dice y ofrece «Descargar sin archivos». Sin lógica de datos: la cuenta la da
// getContactArcoSummary y la descarga la ruta GET.
import { useEffect, useState } from "react";
import { getContactArcoSummary } from "@/lib/actions/contact-arco";
import { megabytes } from "@/lib/contacts/arco/export-files";
import type { ContactArcoSummary } from "@/lib/contacts/arco/summary";
import { ArcoDialog } from "./arco-dialog";

type Phase = { kind: "loading" } | { kind: "confirm"; summary: ContactArcoSummary } | { kind: "load-error"; message: string };

const n = (value: number, one: string, many: string) => `${value.toLocaleString("es-MX")} ${value === 1 ? one : many}`;

/** Renglones de «Se descarga un .zip con…». */
export function exportLines(s: ContactArcoSummary): string[] {
  const e = s.exportar;
  return [
    "Sus datos del CRM: contacto, Detalle, etapa y origen",
    s.chats === 0 ? "Sin chats" : `${n(s.chats, "chat completo", "chats completos")} (${n(s.mensajes, "mensaje", "mensajes")}), también en texto para leerlo`,
    e.archivos === 0 ? "Ningún archivo del cliente" : `${n(e.archivos, "archivo", "archivos")} que mandó el cliente (${megabytes(e.bytes)})`,
  ];
}

function downloadUrl(contactId: string, withFiles: boolean): string {
  return `/api/contactos/${encodeURIComponent(contactId)}/exportar${withFiles ? "" : "?sinArchivos=1"}`;
}

// Un <a download> en vez de navegar: la página se queda donde está y el navegador guarda el zip.
function startDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportContactDialog({ contactId, contactName, onClose }: { contactId: string; contactName: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void getContactArcoSummary(contactId)
      .then((result) => {
        if (!alive) return;
        setPhase(result.ok ? { kind: "confirm", summary: result.summary } : { kind: "load-error", message: result.message });
      })
      .catch(() => {
        if (alive) setPhase({ kind: "load-error", message: "No se pudo preparar la exportación. Revisa tu conexión." });
      });
    return () => {
      alive = false;
    };
  }, [contactId]);

  const tooBig = phase.kind === "confirm" && phase.summary.exportar.demasiado;

  function download(withFiles: boolean) {
    startDownload(downloadUrl(contactId, withFiles));
    onClose();
  }

  return (
    <ArcoDialog
      title={`¿Exportar los datos de «${contactName}»?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Cancelar
          </button>
          {phase.kind === "confirm" && (
            <button
              type="button"
              onClick={() => download(!tooBig)}
              className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark"
            >
              {tooBig ? "Descargar sin archivos" : "Exportar datos"}
            </button>
          )}
        </>
      }
    >
      {phase.kind === "loading" && <p className="text-muted-foreground">Revisando qué se exporta…</p>}

      {phase.kind === "load-error" && (
        <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
          ⚠ {phase.message}
        </p>
      )}

      {phase.kind === "confirm" && (
        <div className="space-y-1.5">
          <p>Se descarga un archivo .zip en esta computadora con:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {exportLines(phase.summary).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {tooBig && (
            <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
              ⚠ Los archivos pesan {megabytes(phase.summary.exportar.bytes)} y el máximo es {megabytes(phase.summary.exportar.maxBytes)}: se puede
              descargar sin archivos (los datos y el chat completos).
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Lleva datos personales del cliente: guárdalo en un lugar seguro y bórralo cuando ya no lo necesites. En el CRM no
            cambia nada.
          </p>
        </div>
      )}
    </ArcoDialog>
  );
}
