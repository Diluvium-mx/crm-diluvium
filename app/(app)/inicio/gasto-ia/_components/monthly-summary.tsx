// Resumen por mes del Gasto de IA (una fila por mes, el más reciente arriba). Sin lógica de datos:
// las filas ya vienen calculadas (lib/dashboard/ai-spend-history.ts › monthlyRows).
import type { MonthRow } from "@/lib/dashboard/ai-spend-history";
import { formatUsd } from "@/lib/usd-format";

export function MonthlySummary({ months }: { months: MonthRow[] }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Resumen por mes</h2>
      <p className="text-[11px] text-muted-foreground">Saldo al cierre = recargas hasta ese día − gasto desde la primera recarga (todos los proveedores).</p>
      {months.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Todavía no hay gasto registrado.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 font-medium">Mes</th>
                <th className="py-1 text-right font-medium">Gasto</th>
                <th className="py-1 text-right font-medium">En producción</th>
                <th className="py-1 text-right font-medium">Pruebas</th>
                <th className="py-1 text-right font-medium">Recargas</th>
                <th className="py-1 text-right font-medium">Saldo al cierre</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="py-1">
                    {m.label}
                    {m.inProgress && <span className="text-muted-foreground"> (en curso)</span>}
                  </td>
                  <td className="py-1 text-right font-medium">{formatUsd(m.total)}</td>
                  <td className="py-1 text-right">{formatUsd(m.prod)}</td>
                  <td className="py-1 text-right">{formatUsd(m.tests)}</td>
                  <td className="py-1 text-right">{formatUsd(m.topupsUsd)}</td>
                  <td className="py-1 text-right">{m.balanceUsd === null ? "—" : formatUsd(m.balanceUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
