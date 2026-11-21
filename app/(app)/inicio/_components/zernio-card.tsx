// «Zernio» (23-oct-2026, pedido del dueño: todos los costos en el Dashboard): lo que va del mes de
// Zernio, por mensajes enviados y por cuentas conectadas, lo del mes anterior y un aviso naranja si
// Zernio marca un pago pendiente. Desde el 2-nov-2026 arriba va la factura estimada del mes (como en
// Railway) y los mensajes enviados contra los 10,000 gratis. Debajo de Railway, mismos permisos. Sin
// lógica de datos: recibe el resumen ya calculado (lib/dashboard/zernio.ts).
import { ZERNIO_FREE_MESSAGES, zernioFreshness, type ZernioSummary } from "@/lib/dashboard/zernio";
import { formatUsd } from "@/lib/usd-format";
import { ProgressBar } from "@/components/ui/progress-bar";
import { InfoNote } from "@/components/ui/info-note";

const whole = new Intl.NumberFormat("es-MX");

function money(usd: number | null): string {
  return usd === null ? "—" : formatUsd(usd);
}

function sentLine(s: ZernioSummary, sent: number): string {
  if (sent < ZERNIO_FREE_MESSAGES) {
    const extra = s.messagesUsd ? ` · van ${formatUsd(s.messagesUsd)}` : "";
    return `de ${whole.format(ZERNIO_FREE_MESSAGES)} gratis este mes${extra}`;
  }
  return `Pasó los ${whole.format(ZERNIO_FREE_MESSAGES)} gratis: van ${money(s.messagesUsd)} (US$1 por cada 10,000)`;
}

export function ZernioCard({ summary }: { summary: ZernioSummary }) {
  const fresh = zernioFreshness(summary);
  const s = summary;
  const accountsFree = s.accountsUsd === 0;
  const soFar = [s.totalUsd !== null && `Va: ${formatUsd(s.totalUsd)}`, s.prevTotalUsd !== null && `${s.prevMonthLabel ? `En ${s.prevMonthLabel}` : "Mes anterior"}: ${formatUsd(s.prevTotalUsd)}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold sm:text-2xl">Zernio (WhatsApp e Instagram)</h2>
          {s.monthLabel && <span className="mt-0.5 block text-sm text-muted-foreground">Mes de {s.monthLabel} (días UTC)</span>}
          <span className={`block text-sm ${fresh.tone === "orange" ? "text-brand-orange" : "text-muted-foreground"}`}>{fresh.text}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Factura estimada{s.monthLabel ? ` de ${s.monthLabel}` : ""}</p>
          <p className="text-4xl font-semibold tabular-nums">{s.estimatedBillUsd === null ? "—" : `≈ ${formatUsd(s.estimatedBillUsd)}`}</p>
          <p className="text-xs text-muted-foreground">
            {s.estimatedBillUsd === null ? "Se calcula después del primer día del mes" : "Si siguen al ritmo de estos días"}
          </p>
          {soFar && <p className="text-xs text-muted-foreground tabular-nums">{soFar}</p>}
        </div>
      </div>
      {s.billingAlert && (
        <p role="alert" className="mt-3 rounded-md border border-brand-orange px-3 py-2 text-sm font-semibold text-brand-orange">
          {s.billingAlert}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <span className="text-xs text-muted-foreground">Mensajes enviados</span>
          {s.sentCount !== null && s.freePct !== null ? (
            <>
              <span className="text-2xl font-semibold tabular-nums">{whole.format(s.sentCount)}</span>
              <ProgressBar value={s.freePct} label="Mensajes gratis de Zernio usados este mes" />
              <span className="text-xs text-muted-foreground tabular-nums">{sentLine(s, s.sentCount)}</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-semibold tabular-nums">{money(s.messagesUsd)}</span>
              <span className="text-xs text-muted-foreground">Los primeros 10,000 del mes son gratis; luego US$1 por cada 10,000</span>
            </>
          )}
        </div>
        <div className="flex flex-col rounded-md border p-3">
          <span className="text-xs text-muted-foreground">Cuentas conectadas</span>
          <span className="text-2xl font-semibold tabular-nums">{accountsFree ? "Gratis" : money(s.accountsUsd)}</span>
          <span className="text-xs text-muted-foreground">El crédito de US$12 al mes de Zernio cubre WhatsApp e Instagram</span>
        </div>
      </div>
      {s.otherUsd > 0 && <p className="mt-3 text-sm tabular-nums">Otros cargos de Zernio: {formatUsd(s.otherUsd)}</p>}
      <InfoNote>
        Lo que Meta cobra por WhatsApp no pasa por Zernio. Zernio cobra a la tarjeta conforme se junta el consumo y anota los
        mensajes de cada día al día siguiente. Lo lee el CRM de Zernio cada 15 minutos. No incluye impuestos.
      </InfoNote>
    </div>
  );
}
