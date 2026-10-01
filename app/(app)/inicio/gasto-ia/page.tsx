import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { aiSpendHistory } from "@/lib/dashboard/ai-spend-history";
import { resolveRange } from "@/lib/dashboard/range";
import { formatDollars, formatUsd } from "@/lib/usd-format";
import { BreakdownList } from "../_components/breakdown-list";
import { DailyChart } from "../_components/daily-chart";
import { RangeFilter } from "../_components/range-filter";
import { MonthlySummary } from "./_components/monthly-summary";
import { PeriodTopups } from "./_components/period-topups";
import { SpendCards } from "./_components/spend-cards";

// Dashboard › Historial del gasto de IA (1-oct-2026, pedido del dueño): el gasto de cada mes o del
// periodo elegido, igual que "Conversaciones nuevas" pero en dólares. Días UTC (los de la consola de
// cada proveedor). Lo ve quien ve el Gasto de IA en el Dashboard.
function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function GastoIaPage({ searchParams }: PageProps<"/inicio/gasto-ia">) {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "aiSpend", "read")) notFound();
  const params = await searchParams;
  const range = resolveRange({ mes: param(params.mes), desde: param(params.desde), hasta: param(params.hasta) }, new Date(), "UTC");
  const history = await aiSpendHistory(db, organizationId, range);
  const breakdownProps = { format: formatUsd, emptyText: "Sin gasto en el periodo." };
  const prodTotal = (rows: { total: number }[]) => rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        {/* Igual que «← Workflows» de Automatización (pedido del dueño, 1-oct-2026). */}
        <Link
          href="/inicio"
          aria-label="Regresar a Dashboard"
          title="Regresar a Dashboard"
          className="flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="max-sm:hidden">Dashboard</span>
        </Link>
        <h1 className="text-lg font-semibold">Historial del gasto de IA</h1>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Lo que cobró cada proveedor, por día UTC (igual que su consola).
          {history.firstDataDay ? ` Hay datos desde el ${history.firstDataDay}.` : ""}
        </p>
        <RangeFilter
          key={`${range.desde}_${range.hasta}`}
          mes={range.mes}
          desde={range.desde}
          hasta={range.hasta}
          basePath="/inicio/gasto-ia"
          timeZone="UTC"
        />
      </header>

      <SpendCards history={history} />

      <DailyChart
        title="Gasto por día"
        valueHeader="Gasto"
        format={formatUsd}
        series={history.series.map((d) => ({ dia: d.dia, total: d.total }))}
        extra={[
          { header: "En producción", values: Object.fromEntries(history.series.map((d) => [d.dia, formatDollars(d.prod)])) },
          { header: "Pruebas", values: Object.fromEntries(history.series.map((d) => [d.dia, formatDollars(d.tests)])) },
        ]}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <BreakdownList title="Por proveedor" total={history.total} rows={history.byProvider} {...breakdownProps} />
        <BreakdownList
          title="Por modelo"
          note="Solo producción (registro del CRM)"
          total={prodTotal(history.byModel)}
          rows={history.byModel}
          {...breakdownProps}
        />
        <BreakdownList
          title="Por tarea"
          note="Solo producción (registro del CRM)"
          total={prodTotal(history.byTask)}
          rows={history.byTask}
          {...breakdownProps}
        />
      </div>

      <MonthlySummary months={history.months} />

      <PeriodTopups topups={history.topups} />
    </div>
  );
}
