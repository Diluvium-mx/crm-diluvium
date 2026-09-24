// "Gasto de IA" (solo owner/admin): por proveedor, el gasto del mes y un saldo
// ESTIMADO = recargas − gasto de producción desde la primera recarga. Ni OpenAI ni
// Anthropic dan el saldo por API (docs/investigacion/gasto-ia-saldo.md). Sin lógica
// de datos: recibe el resumen ya calculado (lib/dashboard/ai-spend.ts).
import type { AiSpendSummary, ProviderSpend } from "@/lib/dashboard/ai-spend";
import { AiTopups } from "./ai-topups";

const usd = new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Balance({ p }: { p: ProviderSpend }) {
  if (p.balanceUsd === null) {
    return <span className="text-muted-foreground">Registra una recarga para ver el saldo estimado.</span>;
  }
  return (
    <>
      <span className="text-muted-foreground">Saldo estimado: </span>
      <span className={`font-semibold tabular-nums ${p.balanceUsd <= 0 ? "text-brand-orange" : "text-foreground"}`}>{usd.format(p.balanceUsd)}</span>
      <span className="block text-xs text-muted-foreground">
        {usd.format(p.loadedUsd ?? 0)} cargados − {usd.format(p.spentSinceFirstUsd ?? 0)} gastados desde el {p.firstTopupOn}
      </span>
    </>
  );
}

export function AiSpendCard({ summary, canRegister }: { summary: AiSpendSummary; canRegister: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Gasto de IA</h2>
        <span className="text-xs text-muted-foreground">Gasto de {summary.monthLabel}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {summary.providers.map((p) => (
          <div key={p.provider} className="flex flex-col gap-1 rounded-md border p-3">
            <p className="text-xs font-medium text-foreground">{p.label}</p>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">Gasto del mes</span>
              <span className="text-lg font-semibold tabular-nums">{usd.format(p.monthUsd)}</span>
            </div>
            <p className="mt-1 text-sm">
              <Balance p={p} />
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Es un <strong>estimado</strong>: el gasto se calcula con los tokens que registra el CRM y los precios de cada modelo;
        no incluye impuestos ni lo que gaste otra app con la misma llave. El saldo real está en el panel de cada proveedor.
      </p>
      <AiTopups topups={summary.topups} canRegister={canRegister} />
    </div>
  );
}
