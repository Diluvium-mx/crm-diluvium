// «WhatsApp (Meta)» (4-nov-2026, pedido del dueño): lo que Meta va cobrando por WhatsApp en el mes, según lo que
// Meta reporta del número (lo lee el worker cada hora de Zernio), y lo del mes anterior. «Detalle» abre la sección
// Dashboard › Gasto de WhatsApp. Debajo de Zernio, mismos permisos. Sin lógica de datos: recibe el resumen ya
// calculado (lib/dashboard/meta-whatsapp.ts).
import Link from "next/link";
import { metaFreshness, type MetaWhatsappSummary } from "@/lib/dashboard/meta-whatsapp";
import { formatUsd } from "@/lib/usd-format";

export function MetaWhatsappCard({ summary }: { summary: MetaWhatsappSummary }) {
  const fresh = metaFreshness(summary);
  const s = summary;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">WhatsApp (Meta)</h2>
            <Link href="/inicio/whatsapp" className="-my-1 rounded border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
              Detalle
            </Link>
          </div>
          <span className="block text-xs text-muted-foreground">Mes de {s.monthLabel} (días UTC)</span>
          <span className={`block text-xs ${fresh.tone === "orange" ? "text-brand-orange" : "text-muted-foreground"}`}>{fresh.text}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Este mes</p>
          <p className="text-4xl font-semibold tabular-nums">{s.totalUsd === null ? "—" : formatUsd(s.totalUsd)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {s.charged === 1 ? "1 mensaje cobrado" : `${s.charged.toLocaleString("es-MX")} mensajes cobrados`}
          </p>
          {s.prevTotalUsd !== null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              En {s.prevMonthLabel}: {formatUsd(s.prevTotalUsd)}
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Lo que Meta cobra por WhatsApp: plantillas y mensajes que salen cuando el chat ya no es gratis. Meta lo carga a la
        tarjeta el día 1, sin IVA. Lo lee el CRM de Zernio cada hora; Meta puede tardar unas horas en reportarlo.
      </p>
    </div>
  );
}
