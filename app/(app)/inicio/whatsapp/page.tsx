import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { metaWhatsappHistory } from "@/lib/dashboard/meta-whatsapp";
import { resolveRange } from "@/lib/dashboard/range";
import { formatUsd } from "@/lib/usd-format";
import { BreakdownList } from "../_components/breakdown-list";
import { DailyChart } from "../_components/daily-chart";
import { RangeFilter } from "../_components/range-filter";
import { MetaCards } from "./_components/meta-cards";
import { CelularCard } from "./_components/celular-card";

// Dashboard › Gasto de WhatsApp (4-nov-2026, pedido del dueño; docs/meta-whatsapp.md): lo que cobró Meta por
// WhatsApp en el periodo, por tipo de mensaje, y quién lo gastó según la marca de Meta en cada mensaje. Solo
// aquí: ni la Bandeja ni el Embudo muestran la marca. Días UTC (los de la factura de Meta). Lo ve quien ve
// el Gasto de IA en el Dashboard.
function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function GastoWhatsappPage({ searchParams }: PageProps<"/inicio/whatsapp">) {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "aiSpend", "read")) notFound();
  const params = await searchParams;
  const range = resolveRange({ mes: param(params.mes), desde: param(params.desde), hasta: param(params.hasta) }, new Date(), "UTC");
  const history = await metaWhatsappHistory(db, organizationId, range);
  const money = { format: formatUsd, emptyText: "Sin cobros en el periodo." };
  const sum = (rows: { total: number }[]) => rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/inicio"
          aria-label="Regresar a Dashboard"
          title="Regresar a Dashboard"
          className="flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="max-sm:hidden">Dashboard</span>
        </Link>
        <h1 className="text-lg font-semibold">Gasto de WhatsApp</h1>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Lo que cobra Meta por WhatsApp, por día UTC (como su factura). Meta lo carga a la tarjeta el día 1, sin IVA.
        </p>
        <RangeFilter
          key={`${range.desde}_${range.hasta}`}
          mes={range.mes}
          desde={range.desde}
          hasta={range.hasta}
          basePath="/inicio/whatsapp"
          timeZone="UTC"
        />
      </header>

      <MetaCards history={history} />

      <DailyChart title="Cobro por día" valueHeader="Cobro" format={formatUsd} series={history.series} />

      <div className="grid gap-3 md:grid-cols-3">
        <BreakdownList title="Por tipo de mensaje" note="Lo que reporta Meta" total={sum(history.byCategory)} rows={history.byCategory} {...money} />
        <BreakdownList
          title="¿Quién lo gastó?"
          note={
            history.marksSince
              ? `Marca de Meta en cada mensaje, desde el ${history.marksSince}. Aproximado: mensajes × lo que cobró Meta en promedio.`
              : "Sale cuando Meta marque los primeros mensajes."
          }
          total={sum(history.byOrigin)}
          rows={history.byOrigin}
          {...money}
          emptyText="Sin mensajes marcados como cobrados en el periodo."
        />
        <BreakdownList
          title="Lo que más cuesta"
          note="Automatizaciones y plantillas (aproximado)"
          total={sum(history.topItems)}
          rows={history.topItems}
          {...money}
          emptyText="Sin automatizaciones ni plantillas cobradas en el periodo."
        />
      </div>

      <CelularCard total={history.celular} porMes={history.celularPorMes} />
    </div>
  );
}
