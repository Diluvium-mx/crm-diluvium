// "Gasto de IA" (solo owner/admin): por proveedor, el gasto del mes y un saldo
// ESTIMADO = recargas − gasto de producción desde la primera recarga, con una barra
// del % de créditos usados. Ni OpenAI ni Anthropic dan el saldo por API
// (docs/investigacion/gasto-ia-saldo.md). Sin lógica de datos: recibe el resumen ya
// calculado (lib/dashboard/ai-spend.ts); la barra sale de lib/dashboard/ai-spend-bar.ts.
import type { AiSpendSummary, ProviderSpend } from "@/lib/dashboard/ai-spend";
import { spendBar } from "@/lib/dashboard/ai-spend-bar";
import { formatUsd } from "@/lib/usd-format";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AiTopups } from "./ai-topups";

function Balance({ p }: { p: ProviderSpend }) {
  const bar = spendBar(p);
  if (!bar) {
    return <p className="mt-1 text-sm text-muted-foreground">Registra una recarga para ver el saldo estimado.</p>;
  }
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-24 flex-1">
          <ProgressBar value={bar.widthPct} tone={bar.tone} label={`Créditos de ${p.label} usados`} />
        </div>
        <span className={`shrink-0 text-xs tabular-nums text-foreground ${bar.tone === "orange" ? "font-semibold" : "font-medium"}`}>
          {bar.text}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {formatUsd(p.loadedUsd ?? 0)} cargados − {formatUsd(p.spentSinceFirstUsd ?? 0)} gastados desde el {p.firstTopupOn}
      </span>
    </div>
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
              <span className="text-lg font-semibold tabular-nums">{formatUsd(p.monthUsd)}</span>
            </div>
            <Balance p={p} />
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
