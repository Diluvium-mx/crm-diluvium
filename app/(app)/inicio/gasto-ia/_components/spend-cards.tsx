// Tres cifras del periodo elegido (gasto, recargas y promedio por día) y, en el mes en curso, la
// proyección del cierre. Sin lógica de datos: recibe el historial ya calculado
// (lib/dashboard/ai-spend-history.ts). Flecha y signo cargan la dirección, sin verde/rojo.
import type { AiSpendHistory } from "@/lib/dashboard/ai-spend-history";
import { formatDollars, formatUsd } from "@/lib/usd-format";

function delta(actual: number, anterior: number): string {
  const diff = Math.round((actual - anterior) * 100) / 100;
  if (diff === 0) return "= igual que";
  const pct = anterior > 0 ? ` (${diff > 0 ? "+" : ""}${Math.round((diff / anterior) * 100)}%)` : "";
  return `${diff > 0 ? "▲ +" : "▼ "}${formatUsd(diff)}${pct} vs`;
}

export function SpendCards({ history }: { history: AiSpendHistory }) {
  const { comparison, projection } = history;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Gasto del periodo</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatUsd(history.total)}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            En producción: {formatDollars(history.prod)} · Pruebas: {formatDollars(history.tests)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {comparison ? (
              <>
                {delta(comparison.actual, comparison.anterior)} {comparison.label}{" "}
                <span className="tabular-nums">({formatUsd(comparison.anterior)})</span>
              </>
            ) : (
              "Sin datos del periodo anterior para comparar."
            )}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Recargas del periodo</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatUsd(history.topupsUsd)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {history.topups.length === 1 ? "1 recarga" : `${history.topups.length} recargas`}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Promedio por día</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatUsd(history.avgPerDay)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {history.daysCounted === 1 ? "en 1 día" : `en ${history.daysCounted} días`}
          </p>
        </div>
      </div>
      {projection && (
        <p className="text-xs text-muted-foreground">
          A este ritmo (<span className="tabular-nums">{formatUsd(projection.ratePerDay)}</span> por día, promedio de los últimos 7
          días), {projection.monthLabel} cerraría en{" "}
          <strong className="tabular-nums text-foreground">~{formatUsd(projection.projectedUsd)}</strong>.
        </p>
      )}
    </div>
  );
}
