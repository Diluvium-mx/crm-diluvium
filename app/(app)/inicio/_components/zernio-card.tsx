// «Zernio» (23-oct-2026, pedido del dueño: todos los costos en el Dashboard): lo que va del mes de
// Zernio, por mensajes enviados y por cuentas conectadas, lo del mes anterior y un aviso naranja si
// Zernio marca un pago pendiente. Debajo de Railway, mismos permisos. Sin lógica de datos: recibe el
// resumen ya calculado (lib/dashboard/zernio.ts).
import { zernioFreshness, type ZernioSummary } from "@/lib/dashboard/zernio";
import { formatUsd } from "@/lib/usd-format";

function money(usd: number | null): string {
  return usd === null ? "—" : formatUsd(usd);
}

export function ZernioCard({ summary }: { summary: ZernioSummary }) {
  const fresh = zernioFreshness(summary);
  const s = summary;
  const accountsFree = s.accountsUsd === 0;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Zernio (WhatsApp e Instagram)</h2>
          {s.monthLabel && <span className="block text-xs text-muted-foreground">Mes de {s.monthLabel} (días UTC)</span>}
          <span className={`block text-xs ${fresh.tone === "orange" ? "text-brand-orange" : "text-muted-foreground"}`}>{fresh.text}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Este mes</p>
          <p className="text-4xl font-semibold tabular-nums">{money(s.totalUsd)}</p>
          {s.prevTotalUsd !== null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {s.prevMonthLabel ? `En ${s.prevMonthLabel}` : "Mes anterior"}: {formatUsd(s.prevTotalUsd)}
            </p>
          )}
        </div>
      </div>
      {s.billingAlert && (
        <p role="alert" className="mt-3 rounded-md border border-brand-orange px-3 py-2 text-sm font-semibold text-brand-orange">
          {s.billingAlert}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col rounded-md border p-3">
          <span className="text-xs text-muted-foreground">Mensajes enviados</span>
          <span className="text-2xl font-semibold tabular-nums">{money(s.messagesUsd)}</span>
          <span className="text-xs text-muted-foreground">Los primeros 10,000 del mes son gratis; luego US$1 por cada 10,000</span>
        </div>
        <div className="flex flex-col rounded-md border p-3">
          <span className="text-xs text-muted-foreground">Cuentas conectadas</span>
          <span className="text-2xl font-semibold tabular-nums">{accountsFree ? "Gratis" : money(s.accountsUsd)}</span>
          <span className="text-xs text-muted-foreground">El crédito de US$12 al mes de Zernio cubre WhatsApp e Instagram</span>
        </div>
      </div>
      {s.otherUsd > 0 && <p className="mt-3 text-sm tabular-nums">Otros cargos de Zernio: {formatUsd(s.otherUsd)}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        Lo que Meta cobra por WhatsApp no pasa por Zernio. Zernio cobra a la tarjeta conforme se junta el consumo. Lo lee el CRM
        de Zernio cada 15 minutos. No incluye impuestos.
      </p>
    </div>
  );
}
