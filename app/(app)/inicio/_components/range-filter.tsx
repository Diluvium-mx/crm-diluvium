"use client";

// Filtro de periodo compartido (Dashboard, sus historiales y la tabla de Anuncios) en UNA fila: atajos (Hoy, 7 días,
// 30 días, Este mes) y el periodo en un solo control (23-nov-2026, pedido del dueño: antes eran «Mes», «Desde»,
// «Hasta» y «Aplicar»; ahora un calendario de rango como el de Meta Ads, components/ui/date-range-picker.tsx). El
// estado vive en la URL (?mes= o ?desde=&hasta=): un mes completo (o este mes hasta hoy) va como ?mes=, igual que
// antes; el servidor valida y recalcula. `basePath` es la página que recibe los parámetros.
import { useRouter } from "next/navigation";
import { DASHBOARD_TIME_ZONE } from "@/lib/dashboard/range";
import { rangeQuery } from "@/lib/dates/range-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";

function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function daysAgo(days: number, timeZone: string): string {
  return localDay(new Date(Date.now() - days * 86_400_000), timeZone);
}

// `timeZone`: de qué zona son los días de los atajos (el historial del Gasto de IA usa "UTC").
// `keep`: otros filtros de la página que se conservan al cambiar el periodo (p. ej. «etapa=compra»).
export function RangeFilter({
  mes,
  desde,
  hasta,
  basePath = "/inicio",
  timeZone = DASHBOARD_TIME_ZONE,
  keep = "",
}: {
  mes: string | null;
  desde: string;
  hasta: string;
  basePath?: string;
  timeZone?: string;
  keep?: string;
}) {
  const router = useRouter();
  const extra = keep ? `&${keep}` : "";

  const today = localDay(new Date(), timeZone);
  const shortcuts: { label: string; href: string; active: boolean }[] = [
    { label: "Hoy", href: `${basePath}?desde=${today}&hasta=${today}${extra}`, active: mes === null && desde === today && hasta === today },
    { label: "7 días", href: `${basePath}?desde=${daysAgo(6, timeZone)}&hasta=${today}${extra}`, active: mes === null && desde === daysAgo(6, timeZone) && hasta === today },
    { label: "30 días", href: `${basePath}?desde=${daysAgo(29, timeZone)}&hasta=${today}${extra}`, active: mes === null && desde === daysAgo(29, timeZone) && hasta === today },
    { label: "Este mes", href: `${basePath}?mes=${today.slice(0, 7)}${extra}`, active: mes === today.slice(0, 7) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
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
      <DateRangePicker
        desde={desde}
        hasta={hasta}
        today={today}
        onApply={(from, to) => {
          const q = rangeQuery(from, to, today);
          router.push("mes" in q ? `${basePath}?mes=${q.mes}${extra}` : `${basePath}?desde=${q.desde}&hasta=${q.hasta}${extra}`);
        }}
      />
    </div>
  );
}
