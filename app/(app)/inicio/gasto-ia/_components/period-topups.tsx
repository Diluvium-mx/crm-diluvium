// Recargas del periodo elegido (solo lectura: se registran y borran en la tarjeta del Dashboard).
import type { TopupRow } from "@/lib/dashboard/ai-spend";
import { formatUsd } from "@/lib/usd-format";

export function PeriodTopups({ topups }: { topups: TopupRow[] }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Recargas del periodo</h2>
      {topups.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Sin recargas en el periodo.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y text-xs">
          {topups.map((t) => (
            <li key={t.id} className="py-1 text-foreground">
              {t.toppedUpOn} · {t.label} · <span className="tabular-nums">{formatUsd(t.amountUsd)}</span>
              {t.author ? <span className="text-muted-foreground"> · {t.author}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
