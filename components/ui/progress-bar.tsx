// Barra de progreso lineal compartida: navy normal y naranja solo como alerta
// (regla de marca). Sin lógica de datos: recibe el porcentaje ya calculado; lo que
// quede fuera de 0–100 se recorta para el dibujo.
export type ProgressTone = "navy" | "orange";

const FILL: Record<ProgressTone, string> = {
  navy: "bg-brand-navy dark:bg-[#6fa3dc]",
  orange: "bg-brand-orange",
};

export function ProgressBar({ value, tone = "navy", label }: { value: number; tone?: ProgressTone; label: string }) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(pct)}
      className="h-2 w-full overflow-hidden rounded-full bg-muted ring-1 ring-black/5 ring-inset dark:ring-white/10"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none ${FILL[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
