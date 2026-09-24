"use client";

// "% de convencimiento" del Detalle del contacto: barra de progreso lineal (lo que
// se ve de un vistazo) + selector desplegable de 10 en 10 (lo que se edita). Sin
// lógica de datos: el guardado lo hace el padre (contact-details.tsx).

const STEPS = Array.from({ length: 11 }, (_, i) => i * 10);

export function ConvencimientoPicker({
  value,
  onChange,
  selectClassName,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  selectClassName: string;
}) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden="true" className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted ring-1 ring-black/5 ring-inset dark:ring-white/10">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* El ancho lo da el envoltorio: la clase compartida del campo trae w-full. */}
      <div className="w-24 shrink-0">
        <select
          aria-label="Porcentaje de convencimiento"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={selectClassName}
        >
          <option value="">—</option>
          {STEPS.map((p) => (
            <option key={p} value={p}>
              {p}%
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
