// "Gasto de IA" (todos lo ven y registran recargas; desde la Fase E va HASTA ARRIBA del Dashboard,
// con cifras grandes: el saldo importa más que las métricas). Por proveedor, el gasto del mes,
// cuánto fue de producción y cuánto de pruebas, y el saldo con una barra del % de créditos
// usados. Desde el 1-oct-2026 el gasto y el saldo salen de cada proveedor (los que no dan su
// cobro por API, como Google, siguen estimados). Sin lógica de datos: recibe el resumen ya
// calculado (lib/dashboard/ai-spend.ts); barra y "actualizado hace…" de lib/dashboard/ai-spend-bar.ts.
import type { AiSpendSummary, ProviderSpend } from "@/lib/dashboard/ai-spend";
import { freshness, spendBar } from "@/lib/dashboard/ai-spend-bar";
import { formatDollars, formatUsd } from "@/lib/usd-format";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AiTopups } from "./ai-topups";

function Balance({ p }: { p: ProviderSpend }) {
  const estimated = p.source === "estimado";
  const bar = spendBar(p, { estimated });
  if (!bar) {
    return (
      <p className="mt-2 text-sm text-muted-foreground">Registra una recarga para ver el saldo{estimated ? " estimado" : ""}.</p>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{estimated ? "Saldo estimado" : "Saldo"}</span>
      <span className={`text-2xl font-semibold tabular-nums ${bar.tone === "orange" ? "text-brand-orange" : "text-foreground"}`}>
        {formatUsd(Math.max(0, p.balanceUsd ?? 0))}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-24 flex-1">
          <ProgressBar value={bar.widthPct} tone={bar.tone} label={`Créditos de ${p.label} usados`} />
        </div>
        <span className={`shrink-0 text-xs tabular-nums text-foreground ${bar.tone === "orange" ? "font-semibold" : "font-medium"}`}>
          {bar.text}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {formatUsd(p.loadedUsd ?? 0)} cargados − {formatUsd(p.spentSinceFirstUsd ?? 0)} gastados
        {p.firstTopupOn ? ` desde el ${p.firstTopupOn}` : ""}
      </span>
    </div>
  );
}

export function AiSpendCard({ summary, canRegister }: { summary: AiSpendSummary; canRegister: boolean }) {
  const total = summary.providers.reduce((sum, p) => sum + p.monthUsd, 0);
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Gasto de IA</h2>
          <span className="text-xs text-muted-foreground">Gasto de {summary.monthLabel}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total del mes</p>
          <p className="text-4xl font-semibold tabular-nums">{formatUsd(total)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.providers.map((p) => {
          const fresh = freshness(p);
          return (
            <div key={p.provider} className="flex flex-col rounded-md border p-3">
              <p className="text-sm font-medium text-foreground">{p.label}</p>
              <span className={`text-xs ${fresh.tone === "orange" ? "text-brand-orange" : "text-muted-foreground"}`}>{fresh.text}</span>
              <span className="mt-1 text-xs text-muted-foreground">Gasto del mes</span>
              <span className="text-3xl font-semibold tabular-nums">{formatUsd(p.monthUsd)}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                En producción: {formatDollars(p.monthProdUsd)} · Pruebas: {formatDollars(p.monthTestsUsd)}
              </span>
              <Balance p={p} />
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        El gasto y el saldo vienen de cada proveedor y se actualizan cada 5 minutos; los que dicen «estimado» salen del registro
        del CRM. No incluyen impuestos.
      </p>
      <AiTopups topups={summary.topups} canRegister={canRegister} />
    </div>
  );
}
