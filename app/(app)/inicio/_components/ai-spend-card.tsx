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
import { InfoNote } from "@/components/ui/info-note";
import { isIdleProvider } from "@/lib/dashboard/costo-tiles";
import { shortDate } from "@/lib/dashboard/railway";
import { AiTopups } from "./ai-topups";

// Crédito del plan (27-nov-2026, plan Max de Claude): no es recarga ni gasto propio; se ve aparte con lo que queda del
// ciclo y cuándo vence. Lo que cubre no se descuenta del saldo comprado.
function PlanCredit({ plan }: { plan: NonNullable<ProviderSpend["plan"]> }) {
  const pct = plan.monthlyUsd > 0 ? (plan.usedUsd / plan.monthlyUsd) * 100 : 100;
  return (
    <div className="mt-3 flex flex-col gap-1 border-t pt-2">
      <span className="text-xs text-muted-foreground">Crédito del {plan.label}</span>
      <span className="text-2xl font-semibold tabular-nums text-foreground">{formatUsd(plan.leftUsd)}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-24 flex-1">
          <ProgressBar value={Math.min(100, pct)} tone="navy" label={`Crédito del ${plan.label} usado`} />
        </div>
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
          {formatUsd(plan.usedUsd)} usados de {formatUsd(plan.monthlyUsd)}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        Se gasta antes que el saldo; vence el {shortDate(new Date(`${plan.expiresOn}T12:00:00Z`))} y se renueva
      </span>
    </div>
  );
}

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
      <span className="text-xs text-muted-foreground">{estimated ? "Saldo estimado" : p.plan ? "Saldo comprado" : "Saldo"}</span>
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
  // 20-nov-2026 (opción A del dueño): los que no gastaron nada este mes y no tienen nada que avisar van en una línea.
  const active = summary.providers.filter((p) => !isIdleProvider(p));
  const idle = summary.providers.filter(isIdleProvider);
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold sm:text-2xl">Gasto de IA</h2>
          <span className="mt-0.5 block text-sm text-muted-foreground">Gasto de {summary.monthLabel}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total del mes</p>
          <p className="text-4xl font-semibold tabular-nums">{formatUsd(total)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((p) => {
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
              {p.monthPlanUsd > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  Lo pagó el crédito del {p.plan?.label ?? "plan"}: {formatUsd(p.monthPlanUsd)}
                </span>
              )}
              <Balance p={p} />
              {p.plan && <PlanCredit plan={p.plan} />}
            </div>
          );
        })}
      </div>
      {idle.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground tabular-nums">
          Sin gasto este mes:{" "}
          {idle.map((p) => (p.balanceUsd !== null && p.loadedUsd !== null ? `${p.label} (saldo ${formatUsd(Math.max(0, p.balanceUsd))})` : p.label)).join(" · ")}
        </p>
      )}
      <InfoNote>
        El gasto y el saldo vienen de cada proveedor y se actualizan cada 5 minutos; los que dicen «estimado» salen del registro
        del CRM. No incluyen impuestos.
      </InfoNote>
      <AiTopups topups={summary.topups} canRegister={canRegister} />
    </div>
  );
}
