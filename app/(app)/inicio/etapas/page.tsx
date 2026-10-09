import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { STAGE_HISTORY_LIMIT, listStageHistory, parseWho } from "@/lib/contacts/stage-history-queries";
import { resolveRange } from "@/lib/dashboard/range";
import { formatMazatlan } from "@/lib/historial/labels";
import { listTeam } from "@/lib/team/store";
import { RangeFilter } from "../_components/range-filter";
import { StageHistoryFilters } from "./_components/stage-history-filters";

// Dashboard › Historial de etapas (9-oct-2026, decisión del dueño): cada cambio de etapa de un
// contacto, quién lo hizo y cuándo (hora de Mazatlán). Lo ven todos los roles. Empezó vacío el
// día que se subió (sin sembrar); el periodo por omisión es el mes en curso.
const BASE = "/inicio/etapas";

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function HistorialEtapasPage({ searchParams }: PageProps<"/inicio/etapas">) {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "funnelStage", "read")) notFound();
  const params = await searchParams;
  const range = resolveRange({ mes: param(params.mes), desde: param(params.desde), hasta: param(params.hasta) });
  const [stages, team] = await Promise.all([listFunnelStages(organizationId), listTeam(organizationId)]);
  const etapa = stages.some((s) => s.key === param(params.etapa)) ? (param(params.etapa) ?? "") : "";
  const quien = parseWho(param(params.quien)) ?? "";
  const q = (param(params.q) ?? "").slice(0, 80);
  const { rows, truncated } = await listStageHistory(organizationId, { desde: range.desde, hasta: range.hasta, etapa, quien: quien || null, q });

  const colorOf = new Map(stages.map((s) => [s.key, s.color]));
  const rangeQuery = range.mes ? `mes=${range.mes}` : `desde=${range.desde}&hasta=${range.hasta}`;
  const keep = new URLSearchParams({ ...(etapa && { etapa }), ...(quien && { quien }), ...(q && { q }) }).toString();

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
        <h1 className="text-lg font-semibold">Historial de etapas</h1>
        <p className="text-xs text-muted-foreground">
          Cada vez que un contacto cambió de etapa: quién lo movió y cuándo (hora de Mazatlán). Se guarda desde el 9-oct-2026.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <StageHistoryFilters
          key={`${etapa}_${quien}_${q}`}
          basePath={BASE}
          rangeQuery={rangeQuery}
          etapa={etapa}
          quien={quien}
          q={q}
          stages={stages.map((s) => ({ value: s.key, label: s.name }))}
          people={team.map((m) => ({ value: `u:${m.userId}`, label: m.name }))}
        />
        <RangeFilter key={`${range.desde}_${range.hasta}`} mes={range.mes} desde={range.desde} hasta={range.hasta} basePath={BASE} keep={keep} />
      </div>

      <section className="rounded-lg border bg-card" aria-label="Cambios de etapa">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Sin cambios de etapa con estos filtros.</p>
        ) : (
          <ol className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm md:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1.4fr)_8rem] md:items-center">
                <time dateTime={row.at.toISOString()} className="text-xs tabular-nums text-muted-foreground">
                  {formatMazatlan(row.at)}
                </time>
                <div className="min-w-0">
                  <Link href={`/dashboard?contacto=${encodeURIComponent(row.contactId)}`} data-link="text" className="font-medium">
                    {row.contactName}
                  </Link>
                  {row.phone && row.phone !== row.contactName && <span className="block text-xs tabular-nums text-muted-foreground">{row.phone}</span>}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">{row.fromName}</span>
                  <span aria-label="pasó a" className="text-muted-foreground">
                    →
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
                      style={colorOf.get(row.toStage) ? { backgroundColor: colorOf.get(row.toStage) } : undefined}
                    />
                    {row.toName}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground md:text-right">{row.who}</span>
              </li>
            ))}
          </ol>
        )}
        {truncated && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Se muestran los {STAGE_HISTORY_LIMIT} más recientes; usa las fechas para ver más atrás.
          </p>
        )}
      </section>
    </div>
  );
}
