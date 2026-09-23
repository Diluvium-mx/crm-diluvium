"use client";

// Filtros del Dashboard en UNA fila arriba de las gráficas: mes (cambia al
// elegir) o rango libre (desde/hasta + Aplicar). El estado vive en la URL
// (?mes= o ?desde=&hasta=); el servidor valida y recalcula.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RangeFilter({ mes, desde, hasta }: { mes: string | null; desde: string; hasta: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(desde);
  const [to, setTo] = useState(hasta);
  const rangeValid = from !== "" && to !== "" && from <= to;

  return (
    <div className="flex flex-wrap items-end gap-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Mes</span>
        <input
          type="month"
          value={mes ?? ""}
          onChange={(event) => {
            if (event.target.value) router.push(`/inicio?mes=${event.target.value}`);
          }}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <span className="pb-2 text-muted-foreground">o</span>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Desde</span>
        <input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Hasta</span>
        <input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        disabled={!rangeValid}
        onClick={() => router.push(`/inicio?desde=${from}&hasta=${to}`)}
        className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark disabled:opacity-50"
      >
        Aplicar
      </button>
    </div>
  );
}
