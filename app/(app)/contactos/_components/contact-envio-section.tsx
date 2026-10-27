"use client";

// Sección «Envío» al final del Detalle del contacto (guías de Envia, 27-oct-2026; docs/envios.md), antes de
// «Datos personales». Sin guía: solo «Hacer guía». Con guías: la más nueva arriba con paquetería, rastreo,
// fecha y precio y tres acciones: «Imprimir guía» (abre el PDF listo para la HP: solo la página de la guía,
// carta y tamaño real), «Poner rastreo en el chat» (lo deja escrito en la caja del chat; si no hay caja a la
// vista —pop-up del Embudo o chat fuera de las 24 h—, lo copia) y «Cancelar guía» (pregunta arriba; Envia
// regresa el dinero si no se escaneó). Una fallida muestra el error de Envia tal cual. Todos los roles. Sin
// lógica de datos.
import { useEffect, useState } from "react";
import { Printer, Truck } from "lucide-react";
import { cancelarGuia, getEnvioPanel, type EnvioPanel } from "@/lib/actions/envios";
import { carrierLabel, priceLabel, serviceName, trackingMessage } from "@/lib/envios/messages";
import type { ShipmentView } from "@/lib/envios/store";
import { writeClipboard } from "@/components/ui/copy-button";
import { PruebaBadge } from "@/components/ui/prueba-badge";
import { TopConfirm, TopNotice } from "@/components/ui/top-confirm";
import { requestComposerText } from "../../_components/composer-text";
import { ShipmentDialog } from "./shipment-dialog";

const NOTICE_MS = 4_000;
const SHOWN = 3;

const when = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Mazatlan" });

export function ContactEnvioSection({ contactId, conversationId }: { contactId: string; conversationId: string | null }) {
  const [panel, setPanel] = useState<EnvioPanel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState<ShipmentView | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getEnvioPanel(contactId)
      .then((res) => {
        if (alive) setPanel(res);
      })
      .catch(() => {
        if (alive) setPanel({ ok: false, message: "No se pudieron leer las guías." });
      });
    return () => {
      alive = false;
    };
  }, [contactId]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  function upsert(shipment: ShipmentView) {
    setPanel((p) => (p && p.ok ? { ...p, shipments: [shipment, ...p.shipments.filter((s) => s.id !== shipment.id)] } : p));
  }

  async function putInChat(s: ShipmentView) {
    const text = trackingMessage(s);
    if (conversationId && requestComposerText(conversationId, text)) {
      setNotice("Rastreo listo en la caja del chat: mándalo cuando salga a ruta.");
      return;
    }
    // Sin caja de texto a la vista (pop-up del Embudo o chat fuera de las 24 h): se copia.
    setNotice(
      (await writeClipboard(text))
        ? "Rastreo copiado. Si el chat ya pasó las 24 h, primero hay que mandar una plantilla."
        : "No se pudo copiar el rastreo.",
    );
  }

  async function confirmCancel() {
    if (!canceling) return;
    setCancelBusy(true);
    const res = await cancelarGuia(canceling.id).catch(() => null);
    setCancelBusy(false);
    setCanceling(null);
    if (!res) return setNotice("No se pudo cancelar. Revisa tu conexión.");
    if (!res.ok) return setNotice(res.message);
    upsert(res.shipment);
    setNotice(`Guía cancelada. ${res.refundNote}`);
  }

  const shipments = panel?.ok ? panel.shipments.slice(0, SHOWN) : [];
  const configured = panel?.ok && panel.env !== null;

  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Envío</h3>

      {panel === null && <p className="text-xs text-muted-foreground">Cargando…</p>}
      {panel && !panel.ok && <p className="text-xs text-muted-foreground">{panel.message}</p>}
      {panel?.ok && panel.env === null && <p className="text-xs text-muted-foreground">Envia no está configurado en este servidor.</p>}

      {shipments.map((s) => (
        <div key={s.id} className="space-y-1 rounded-md border px-2.5 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-foreground">
              {carrierLabel(s.carrier)}
              {s.serviceLabel && <span className="font-normal text-muted-foreground"> · {serviceName(s.carrier, s.serviceLabel)}</span>}
            </p>
            <span className="flex items-center gap-1">
              {s.environment === "sandbox" && <PruebaBadge />}
              {s.status === "cancelada" && <span className="text-muted-foreground">Cancelada</span>}
              {s.status === "fallida" && <span className="text-brand-orange">No se generó</span>}
              {s.status === "generando" && <span className="text-muted-foreground">Generando…</span>}
            </span>
          </div>
          {s.trackingNumber && <p className={`font-mono break-all ${s.status === "cancelada" ? "line-through text-muted-foreground" : ""}`}>{s.trackingNumber}</p>}
          <p className="text-muted-foreground">
            {when.format(new Date(s.createdAt))}
            {s.price !== null && ` · ${priceLabel(s.price)}`}
            {s.destination.city && ` · ${s.destination.city}`}
          </p>
          {s.status === "fallida" && s.errorMessage && <p className="text-muted-foreground">{s.errorMessage}</p>}
          {s.status === "creada" && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
              <a href={`/api/envios/${encodeURIComponent(s.id)}/guia`} target="_blank" rel="noopener" data-link="text" className="inline-flex items-center gap-1">
                <Printer className="size-3.5" /> Imprimir guía
              </a>
              <button type="button" data-link="text" data-no-glow="" onClick={() => void putInChat(s)}>
                Poner rastreo en el chat
              </button>
              <button
                type="button"
                data-no-glow=""
                onClick={() => setCanceling(s)}
                className="text-red-600 underline-offset-2 hover:underline focus-visible:underline dark:text-red-400"
              >
                Cancelar guía
              </button>
            </div>
          )}
        </div>
      ))}

      {configured && (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <Truck className="size-3.5" /> Hacer guía
        </button>
      )}

      {dialogOpen && (
        <ShipmentDialog
          contactId={contactId}
          onClose={() => setDialogOpen(false)}
          onCreated={(shipment) => {
            setDialogOpen(false);
            upsert(shipment);
            setNotice(`Guía de ${carrierLabel(shipment.carrier)} lista: ${shipment.trackingNumber ?? ""}`);
          }}
        />
      )}

      {canceling && (
        <TopConfirm
          title={`¿Cancelar la guía ${canceling.trackingNumber ?? ""}?`}
          confirmLabel="Cancelar guía"
          cancelLabel="No"
          pendingLabel="Cancelando…"
          pending={cancelBusy}
          onConfirm={() => void confirmCancel()}
          onCancel={() => setCanceling(null)}
        >
          Envia la cancela y regresa el dinero al saldo si la paquetería todavía no la escanea.
        </TopConfirm>
      )}
      <TopNotice message={notice} />
    </section>
  );
}
