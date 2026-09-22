import type { DailyCount } from "@/lib/dashboard/queries";

// Barras por día (una sola serie: el título la nombra, sin leyenda). Tooltip
// por barra con CSS (hover y foco de teclado): la columna completa es el área
// de acierto, más grande que la barra. Navy de marca en claro; un navy más
// claro en modo noche para que la barra contraste con la tarjeta oscura.
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function shortDay(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

// Tope "redondo" del eje: 1, 2, 5, 10, 20, 50…
function niceMax(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export function DailyChart({ series }: { series: DailyCount[] }) {
  const max = niceMax(Math.max(0, ...series.map((d) => d.total)));
  const total = series.reduce((sum, d) => sum + d.total, 0);
  // Etiquetas del eje X: ~7 repartidas; la última solo si no queda pegada a
  // la anterior, para no encimarlas.
  const labelEvery = Math.max(1, Math.ceil(series.length / 7));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Conversaciones nuevas por día</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{total} en el periodo</span>
      </div>

      <div className="mt-4 flex gap-2">
        {/* Eje Y: tope, mitad y cero. */}
        <div className="flex h-48 flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground">
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className="relative h-48 min-w-0 flex-1">
          {/* Rejilla recesiva */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            <div className="border-t border-dashed border-muted-foreground/20" />
            <div className="border-t border-dashed border-muted-foreground/20" />
            <div className="border-t border-muted-foreground/40" />
          </div>
          <ol className="relative flex h-full items-end gap-0.5" aria-label="Conversaciones nuevas por día">
            {series.map((d) => (
              <li
                key={d.dia}
                tabIndex={0}
                aria-label={`${shortDay(d.dia)}: ${d.total}`}
                className="group relative flex h-full min-w-0 flex-1 items-end outline-none"
              >
                <div
                  className="w-full rounded-t bg-brand-navy transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80 dark:bg-[#6fa3dc]"
                  style={{ height: d.total > 0 ? `${(d.total / max) * 100}%` : "0" }}
                />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] text-background shadow group-hover:block group-focus-visible:block">
                  {shortDay(d.dia)} · <span className="tabular-nums">{d.total}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="ml-8 mt-1 flex gap-0.5 text-[11px] text-muted-foreground" aria-hidden="true">
        {series.map((d, i) => (
          <span key={d.dia} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 || (i === series.length - 1 && i % labelEvery >= labelEvery / 2) ? shortDay(d.dia) : ""}
          </span>
        ))}
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Ver como tabla</summary>
        <table className="mt-2 w-full max-w-xs text-left tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-0.5 font-medium">Día</th>
              <th className="py-0.5 text-right font-medium">Nuevas</th>
            </tr>
          </thead>
          <tbody>
            {series.map((d) => (
              <tr key={d.dia} className="border-t">
                <td className="py-0.5">{shortDay(d.dia)}</td>
                <td className="py-0.5 text-right">{d.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
