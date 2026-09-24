import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import {
  newConversationsBreakdown,
  newConversationsByDay,
  newConversationsCards,
} from "@/lib/dashboard/queries";
import { resolveRange } from "@/lib/dashboard/range";
import { aiSpendSummary } from "@/lib/dashboard/ai-spend";
import { STAGES, STAGE_LABELS } from "../contactos/_data/types";
import { AiSpendCard } from "./_components/ai-spend-card";
import { BreakdownList } from "./_components/breakdown-list";
import { DailyChart } from "./_components/daily-chart";
import { PeriodCards } from "./_components/period-cards";
import { RangeFilter } from "./_components/range-filter";

// Dashboard (A2): destino al entrar. Todos lo ven; "Gasto de IA" solo
// owner/admin. Los datos se calculan en el servidor para la organización de la
// sesión (lib/dashboard/queries.ts).
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  fb: "Facebook",
  instagram: "Instagram",
  otro: "Otro",
};

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function InicioPage({ searchParams }: PageProps<"/inicio">) {
  const { organizationId, role } = await requireActiveMembership();
  const params = await searchParams;
  const range = resolveRange({ mes: param(params.mes), desde: param(params.desde), hasta: param(params.hasta) });

  const canSeeSpend = roleAllows(role, "aiSpend", "read");
  const [cards, series, breakdown, spend] = await Promise.all([
    newConversationsCards(db, organizationId),
    newConversationsByDay(db, organizationId, range),
    newConversationsBreakdown(db, organizationId, range),
    canSeeSpend ? aiSpendSummary(db, organizationId) : null,
  ]);

  const byStage = new Map(breakdown.porEtapa.map((b) => [b.clave, b.total]));
  const anuncioPct = breakdown.total > 0 ? Math.round((breakdown.porAnuncio / breakdown.total) * 100) : 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Conversaciones nuevas = contactos nuevos que escribieron. No cuenta los importados de GHL.
          </p>
        </div>
        <RangeFilter key={`${range.desde}_${range.hasta}`} mes={range.mes} desde={range.desde} hasta={range.hasta} />
      </header>

      <PeriodCards cards={cards} />

      <DailyChart series={series} />

      <div className="grid gap-3 md:grid-cols-3">
        <BreakdownList
          title="Por canal"
          total={breakdown.total}
          rows={breakdown.porCanal.map((b) => ({ label: CHANNEL_LABELS[b.clave] ?? b.clave, total: b.total }))}
        />
        <BreakdownList
          title="Por etapa (actual)"
          total={breakdown.total}
          rows={STAGES.map((stage) => ({ label: STAGE_LABELS[stage], total: byStage.get(stage) ?? 0 }))}
        />
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Llegaron por anuncio</h2>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{breakdown.porAnuncio}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            de {breakdown.total} en el periodo ({anuncioPct}%)
          </p>
        </div>
      </div>

      {spend && <AiSpendCard summary={spend} canRegister={roleAllows(role, "aiSpend", "update")} />}
    </div>
  );
}
