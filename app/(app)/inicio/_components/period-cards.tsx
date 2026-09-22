import type { PeriodCards as PeriodCardsData, PeriodComparison } from "@/lib/dashboard/queries";

// Tres cifras grandes (hoy / semana / mes) con la diferencia contra el mismo
// tramo del periodo anterior. La flecha y el signo cargan la dirección; sin
// verde/rojo (los colores de estado se reservan para alertas).
function delta({ actual, anterior }: PeriodComparison): string {
  const diff = actual - anterior;
  if (diff === 0) return "= igual que";
  const arrow = diff > 0 ? "▲" : "▼";
  const pct = anterior > 0 ? ` (${diff > 0 ? "+" : ""}${Math.round((diff / anterior) * 100)}%)` : "";
  return `${arrow} ${diff > 0 ? "+" : ""}${diff}${pct} vs`;
}

function Tile({ label, compare, value }: { label: string; compare: string; value: PeriodComparison }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value.actual}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {delta(value)} {compare} <span className="tabular-nums">({value.anterior})</span>
      </p>
    </div>
  );
}

export function PeriodCards({ cards }: { cards: PeriodCardsData }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile label="Nuevas hoy" compare="ayer a esta hora" value={cards.hoy} />
      <Tile label="Nuevas esta semana" compare="la semana pasada a estas alturas" value={cards.semana} />
      <Tile label="Nuevas este mes" compare="el mes pasado al mismo día" value={cards.mes} />
    </div>
  );
}
