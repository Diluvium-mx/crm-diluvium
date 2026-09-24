// "Gasto de IA" (solo owner/admin): por proveedor, el gasto del mes de producción y
// el de pruebas (staging), que usan las mismas llaves, y un saldo ESTIMADO =
// recargas − ambos gastos desde la primera recarga. Ni OpenAI ni Anthropic dan el
// saldo por API (docs/investigacion/gasto-ia-saldo.md). Si staging no responde, se
// muestra solo producción con un aviso. Sin lógica de datos: recibe el resumen ya
// calculado (lib/dashboard/ai-spend.ts).
import type { AiSpendSummary, ProviderSpend } from "@/lib/dashboard/ai-spend";
import { AiTopups } from "./ai-topups";

const usd = new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STAGING_NOTICE: Partial<Record<AiSpendSummary["staging"], string>> = {
  unreachable: "No se pudo leer el gasto de pruebas (staging): se muestra solo producción y el saldo solo descuenta producción.",
  no_config:
    "Falta conectar el gasto de pruebas (staging): se muestra solo producción y el saldo solo descuenta producción.",
};

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{usd.format(value)}</span>
    </div>
  );
}

function Balance({ p, withStaging }: { p: ProviderSpend; withStaging: boolean }) {
  if (p.balanceUsd === null) {
    return <span className="text-muted-foreground">Registra una recarga para ver el saldo estimado.</span>;
  }
  const parts = [`${usd.format(p.loadedUsd ?? 0)} cargados`, `${usd.format(p.spentSinceFirstUsd ?? 0)} producción`];
  if (withStaging && p.stagingSpentSinceFirstUsd !== null) parts.push(`${usd.format(p.stagingSpentSinceFirstUsd)} pruebas`);
  return (
    <>
      <span className="text-muted-foreground">Saldo estimado: </span>
      <span className={`font-semibold tabular-nums ${p.balanceUsd <= 0 ? "text-brand-orange" : "text-foreground"}`}>{usd.format(p.balanceUsd)}</span>
      <span className="block text-xs text-muted-foreground">
        {parts.join(" − ")} desde el {p.firstTopupOn}
      </span>
    </>
  );
}

export function AiSpendCard({ summary, canRegister }: { summary: AiSpendSummary; canRegister: boolean }) {
  const isStagingEnv = summary.environment === "staging";
  const withStaging = !isStagingEnv && summary.staging === "ok";
  const notice = isStagingEnv ? null : STAGING_NOTICE[summary.staging];
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Gasto de IA</h2>
        <span className="text-xs text-muted-foreground">Gasto de {summary.monthLabel}</span>
      </div>
      {notice && <p className="mt-2 border-l-2 border-brand-orange pl-2 text-xs text-foreground">{notice}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {summary.providers.map((p) => (
          <div key={p.provider} className="flex flex-col gap-1 rounded-md border p-3">
            <p className="text-xs font-medium text-foreground">{p.label}</p>
            <Amount label={isStagingEnv ? "Gasto pruebas (staging)" : "Gasto producción"} value={p.monthUsd} />
            {withStaging && p.stagingMonthUsd !== null && <Amount label="Gasto pruebas (staging)" value={p.stagingMonthUsd} />}
            <p className="mt-1 text-sm">
              <Balance p={p} withStaging={withStaging} />
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Es un <strong>estimado</strong>: el gasto se calcula con los tokens que registra el CRM y los precios de cada modelo;
        no incluye impuestos ni lo que gaste otra app con la misma llave.
        {isStagingEnv ? " Este es el entorno de pruebas: solo muestra su propio gasto." : ""} El saldo real está en el panel de
        cada proveedor.
      </p>
      <AiTopups topups={summary.topups} canRegister={canRegister} />
    </div>
  );
}
