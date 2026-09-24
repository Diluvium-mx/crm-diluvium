// "Gasto de IA" (solo owner/admin): el gasto del mes por proveedor y un saldo
// ESTIMADO por proveedor = crédito cargado − gasto desde la primera recarga. Ni
// OpenAI ni Anthropic dan el saldo por API (docs/investigacion/gasto-ia-saldo.md).
// Sin lógica de datos: recibe el resumen ya calculado (lib/dashboard/ai-spend.ts).
import type { AiSpendSummary } from "@/lib/dashboard/ai-spend";
import { AiTopups } from "./ai-topups";

const usd = new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AiSpendCard({ summary, canRegister }: { summary: AiSpendSummary; canRegister: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Gasto de IA</h2>
        <span className="text-xs text-muted-foreground">Gasto de {summary.monthLabel}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {summary.providers.map((p) => (
          <div key={p.provider} className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{p.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{usd.format(p.monthUsd)}</p>
            <p className="text-xs text-muted-foreground">gastado este mes</p>
            <p className="mt-2 text-sm">
              {p.balanceUsd === null ? (
                <span className="text-muted-foreground">Registra una recarga para ver el saldo estimado.</span>
              ) : (
                <>
                  <span className="text-muted-foreground">Saldo estimado: </span>
                  <span className={`font-semibold tabular-nums ${p.balanceUsd <= 0 ? "text-brand-orange" : "text-foreground"}`}>
                    {usd.format(p.balanceUsd)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {usd.format(p.loadedUsd ?? 0)} cargados − {usd.format(p.spentSinceFirstUsd ?? 0)} gastados desde el {p.firstTopupOn}
                  </span>
                </>
              )}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Es un <strong>estimado</strong>: el gasto se calcula con los tokens que registra el CRM y los precios de cada modelo;
        no incluye impuestos ni lo que gaste otra app con la misma llave (por ejemplo, las pruebas en staging). El saldo
        real está en el panel de cada proveedor.
      </p>
      <AiTopups topups={summary.topups} canRegister={canRegister} />
    </div>
  );
}
