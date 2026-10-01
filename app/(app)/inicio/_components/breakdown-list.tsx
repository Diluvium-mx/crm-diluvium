// Desglose como barras horizontales de un solo tono: la etiqueta de texto da
// la identidad (no el color) y el número va siempre visible. Conteos por defecto; el historial
// del Gasto de IA lo usa con dólares (`format`), su texto vacío y una nota bajo el título.
export type BreakdownRow = { label: string; total: number };

export function BreakdownList({
  title,
  rows,
  total,
  format = (n: number) => String(n),
  emptyText = "Sin conversaciones nuevas en el periodo.",
  note,
}: {
  title: string;
  rows: BreakdownRow[];
  total: number;
  format?: (n: number) => string;
  emptyText?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
      {total === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const pct = total > 0 ? Math.round((row.total / total) * 100) : 0;
            return (
              <li key={row.label} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span>{row.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {format(row.total)} · {pct}%
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-brand-navy dark:bg-[#6fa3dc]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
