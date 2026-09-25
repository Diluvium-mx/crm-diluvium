"use client";

// Filtro de periodo compartido (Dashboard y tabla de Anuncios) en UNA fila:
// atajos (Hoy, 7 días, 30 días, Este mes), mes (cambia al elegir) o rango libre
// (desde/hasta + Aplicar). El estado vive en la URL (?mes= o ?desde=&hasta=);
// el servidor valida y recalcula. `basePath` es la página que recibe los parámetros.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DASHBOARD_TIME_ZONE } from "@/lib/dashboard/range";

function localDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DASHBOARD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function daysAgo(days: number): string {
  return localDay(new Date(Date.now() - days * 86_400_000));
}

export function RangeFilter({ mes, desde, hasta, basePath = "/inicio" }: { mes: string | null; desde: string; hasta: string; basePath?: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(desde);
  const [to, setTo] = useState(hasta);
  const rangeValid = from !== "" && to !== "" && from <= to;

  const today = localDay(new Date());
  const shortcuts: { label: string; href: string; active: boolean }[] = [
    { label: "Hoy", href: `${basePath}?desde=${today}&hasta=${today}`, active: mes === null && desde === today && hasta === today },
    { label: "7 días", href: `${basePath}?desde=${daysAgo(6)}&hasta=${today}`, active: mes === null && desde === daysAgo(6) && hasta === today },
    { label: "30 días", href: `${basePath}?desde=${daysAgo(29)}&hasta=${today}`, active: mes === null && desde === daysAgo(29) && hasta === today },
    { label: "Este mes", href: `${basePath}?mes=${today.slice(0, 7)}`, active: mes === today.slice(0, 7) },
  ];

  return (
    <div className="flex flex-wrap items-end gap-3 text-xs">
      <div role="group" aria-label="Atajos de periodo" className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
        {shortcuts.map((s) => (
          <button
            key={s.label}
            type="button"
            aria-pressed={s.active}
            onClick={() => router.push(s.href)}
            className={`rounded-md px-2.5 py-1 ${s.active ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Mes</span>
        <input
          type="month"
          value={mes ?? ""}
          onChange={(event) => {
            if (event.target.value) router.push(`${basePath}?mes=${event.target.value}`);
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
        onClick={() => router.push(`${basePath}?desde=${from}&hasta=${to}`)}
        className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark disabled:opacity-50"
      >
        Aplicar
      </button>
    </div>
  );
}
