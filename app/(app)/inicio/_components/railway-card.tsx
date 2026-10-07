// «Railway» (7-oct-2026, pedido del dueño): en el plan Hobby Railway ya no muestra créditos
// restantes; aquí se ve el uso del periodo, lo que queda de lo incluido en el plan y la factura
// estimada al corte, y un aviso naranja si Railway marca un pago pendiente. Debajo del Gasto de
// IA, mismos permisos. Sin lógica de datos: recibe el resumen ya calculado (lib/dashboard/railway.ts).
import { railwayFreshness, type RailwaySummary } from "@/lib/dashboard/railway";
import { formatUsd } from "@/lib/usd-format";
import { ProgressBar } from "@/components/ui/progress-bar";

export function RailwayCard({ summary }: { summary: RailwaySummary }) {
  const fresh = railwayFreshness(summary);
  const s = summary;
  const period = s.periodStartLabel && s.periodEndLabel ? `periodo del ${s.periodStartLabel} al ${s.periodEndLabel}` : null;
  const orange = s.includedTone === "orange";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Railway (servidores del CRM)</h2>
          {(s.planLabel || period) && (
            <span className="block text-xs text-muted-foreground">{[s.planLabel && `Plan ${s.planLabel}`, period].filter(Boolean).join(" · ")}</span>
          )}
          <span className={`block text-xs ${fresh.tone === "orange" ? "text-brand-orange" : "text-muted-foreground"}`}>{fresh.text}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Factura estimada{s.periodEndLabel ? ` al ${s.periodEndLabel}` : ""}</p>
          <p className="text-4xl font-semibold tabular-nums">{s.estimatedBillUsd === null ? "—" : `≈ ${formatUsd(s.estimatedBillUsd)}`}</p>
          <p className="text-xs text-muted-foreground">
            {s.estimatedBillUsd === null ? "Se calcula después del primer día del periodo" : "Si sigue al ritmo de estos días"}
          </p>
        </div>
      </div>
      {s.billingAlert && (
        <p role="alert" className="mt-3 rounded-md border border-brand-orange px-3 py-2 text-sm font-semibold text-brand-orange">
          {s.billingAlert}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col rounded-md border p-3">
          <span className="text-xs text-muted-foreground">Uso del periodo</span>
          <span className="text-2xl font-semibold tabular-nums">{s.usageUsd === null ? "—" : formatUsd(s.usageUsd)}</span>
          <span className="text-xs text-muted-foreground">Producción y staging juntos</span>
        </div>
        {s.includedUsd !== null && s.includedLeftUsd !== null && s.includedPct !== null && (
          <div className="flex flex-col gap-1 rounded-md border p-3">
            <span className="text-xs text-muted-foreground">Incluido en el plan</span>
            <span className={`text-2xl font-semibold tabular-nums ${orange ? "text-brand-orange" : "text-foreground"}`}>
              {formatUsd(s.includedLeftUsd)}
            </span>
            <ProgressBar value={s.includedPct} tone={s.includedTone} label="Uso incluido en el plan de Railway" />
            <span className={`text-xs tabular-nums ${orange ? "font-semibold text-brand-orange" : "text-muted-foreground"}`}>
              {s.overUsd > 0
                ? `Se pasó por ${formatUsd(s.overUsd)}: se cobra a la tarjeta al corte`
                : `${Math.floor(s.includedPct)} % usado · quedan de ${formatUsd(s.includedUsd)}`}
            </span>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {s.includedUsd !== null &&
          `El plan cobra ${formatUsd(s.includedUsd)} al mes e incluye ${formatUsd(s.includedUsd)} de uso; lo que pase de ahí se cobra a la tarjeta el día de corte. `}
        Lo lee el CRM de Railway cada 5 minutos. No incluye impuestos.
      </p>
    </div>
  );
}
