// «WhatsApp (Meta)» (5-oct-2026, pedido del dueño): lo que Meta va cobrando en el mes por los
// mensajes de WhatsApp, sin entrar a Business Suite. Debajo del Gasto de IA, mismos permisos. Sin
// lógica de datos: recibe el resumen ya calculado (lib/dashboard/meta-whatsapp.ts).
import { metaFreshness, type MetaWhatsappSummary } from "@/lib/dashboard/meta-whatsapp";

const amount = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("es-MX");

// "US$0.04" en dólares (como el resto del Dashboard); otra moneda, "MX$12.30" / "EUR 1.00".
function money(value: number, currency: string): string {
  const prefix = currency === "USD" ? "US$" : currency === "MXN" ? "MX$" : `${currency} `;
  return `${prefix}${amount.format(value)}`;
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flex flex-col rounded-md border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{count.format(value)}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

export function MetaWhatsappCard({ summary }: { summary: MetaWhatsappSummary }) {
  const fresh = metaFreshness(summary);
  const free = summary.freeAd + summary.freeService + summary.freeOther;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">WhatsApp (Meta)</h2>
          <span className="text-xs text-muted-foreground">Cobro de {summary.monthLabel}</span>
          <span className={`block text-xs ${fresh.tone === "orange" ? "text-brand-orange" : "text-muted-foreground"}`}>{fresh.text}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total del mes</p>
          <p className="text-4xl font-semibold tabular-nums">{money(summary.monthCost, summary.currency)}</p>
          <p className="text-xs tabular-nums text-muted-foreground">Mes anterior: {money(summary.previousMonthCost, summary.currency)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Stat label="Cuentan para cobro" value={summary.charged} hint={summary.charged === 1 ? "mensaje entregado" : "mensajes entregados"} />
        <Stat label="Gratis por anuncio" value={summary.freeAd} hint="72 h desde que llegó por anuncio" />
        <Stat label="Gratis en la ventana" value={summary.freeService + summary.freeOther} hint="sin costo según Meta" />
      </div>
      {summary.byCategory.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {summary.byCategory.map((c) => (
            <li key={c.label} className="flex justify-between gap-3 tabular-nums">
              <span>
                {c.label} <span className="text-muted-foreground">· {count.format(c.volume)} {c.volume === 1 ? "mensaje" : "mensajes"}</span>
              </span>
              <span className="font-medium">{money(c.cost, summary.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Cifras aproximadas que da Meta, en días UTC; se actualizan cada hora. {count.format(summary.charged + free)} mensajes entregados
        en el mes. Lo enviado desde la app del celular no se cobra. La factura y el pago están en Meta Business Suite › Facturación.
      </p>
    </div>
  );
}
