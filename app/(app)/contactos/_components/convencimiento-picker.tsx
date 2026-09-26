"use client";

// "% de convencimiento" del Detalle del contacto: barra de progreso + el número. Desde el
// 26-sep-2026 (decisión del dueño) es de SOLO LECTURA: lo determina el Agente IA con lo
// que va diciendo el cliente (actualizar_detalle), de 10 en 10. Sin lógica de datos.

export function ConvencimientoBar({ value }: { value: number | null }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label="Porcentaje de convencimiento"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? "Sin dato" : `${value} %`}
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted ring-1 ring-black/5 ring-inset dark:ring-white/10"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">{value === null ? "—" : `${value} %`}</span>
    </div>
  );
}
