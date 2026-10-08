"use client";

// «Datos personales» al final del Detalle del contacto (derechos ARCO, 7-oct-2026), discreta: dos
// acciones de texto, «Exportar datos» (descarga el zip: datos.json, chat.txt y los archivos que
// mandó el cliente) y «Borrar contacto» (rojo; abre la ventana que pide escribir BORRAR). Todos los
// roles. Si los archivos del cliente pasan el tope (200 MB), lo dice y ofrece descargar sin archivos.
// Sin lógica de datos: la cuenta la da getContactArcoSummary y la descarga la ruta GET.
import { useState } from "react";
import { getContactArcoSummary } from "@/lib/actions/contact-arco";
import { megabytes } from "@/lib/contacts/arco/export-files";
import { DeleteContactDialog } from "./delete-contact-dialog";

type Notice = { kind: "too-big"; text: string } | { kind: "error"; text: string };

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
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function exportData() {
    if (checking) return;
    setChecking(true);
    setNotice(null);
    try {
      const result = await getContactArcoSummary(contactId);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.message });
        return;
      }
      const e = result.summary.exportar;
      if (e.demasiado) {
        setNotice({
          kind: "too-big",
          text: `Los ${e.archivos.toLocaleString("es-MX")} archivos que mandó el cliente pesan ${megabytes(e.bytes)} y el máximo es ${megabytes(e.maxBytes)}.`,
        });
        return;
      }
      startDownload(downloadUrl(contactId, true));
    } catch {
      setNotice({ kind: "error", text: "No se pudo preparar la exportación. Revisa tu conexión." });
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="space-y-1.5 border-t pt-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Datos personales</h3>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button type="button" data-link="text" data-no-glow="" disabled={checking} onClick={() => void exportData()} className="disabled:opacity-60">
          {checking ? "Preparando…" : "Exportar datos"}
        </button>
        <button
          type="button"
          data-no-glow=""
          onClick={() => {
            setNotice(null);
            setConfirming(true);
          }}
          className="text-red-600 underline-offset-2 hover:underline focus-visible:underline dark:text-red-400"
        >
          Borrar contacto
        </button>
      </div>

      {notice && (
        <div role="alert" className="space-y-1 rounded-md border border-brand-orange/40 bg-brand-orange/10 px-2.5 py-1.5 text-xs">
          <p>⚠ {notice.text}</p>
          {notice.kind === "too-big" && (
            <button
              type="button"
              data-link="text"
              data-no-glow=""
              onClick={() => {
                setNotice(null);
                startDownload(downloadUrl(contactId, false));
              }}
            >
              Descargar sin archivos (datos y chat completos)
            </button>
          )}
        </div>
      )}

      {confirming && (
        <DeleteContactDialog
          contactId={contactId}
          contactName={contactName}
          onClose={() => setConfirming(false)}
          onDeleted={() => {
            setConfirming(false);
            onDeleted();
          }}
        />
      )}
    </section>
  );
}
