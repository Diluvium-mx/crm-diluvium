import Link from "next/link";
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
import { railwaySummary } from "@/lib/dashboard/railway";
import { loadWhatsappStatus } from "@/lib/monitoring/dashboard-status";
import { loadBotStatus } from "@/lib/monitoring/bot-silence";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { AiSpendCard } from "./_components/ai-spend-card";
import { RailwayCard } from "./_components/railway-card";
import { BreakdownList } from "./_components/breakdown-list";
import { DailyChart } from "./_components/daily-chart";
import { PeriodCards } from "./_components/period-cards";
import { RangeFilter } from "./_components/range-filter";
import { FollowUpCard } from "./_components/follow-up-card";
import { followUpStats } from "@/lib/dashboard/seguimientos";
import { followUpsReal as followUpsRealFor } from "@/lib/followups/store";
import { StatusPill } from "./_components/whatsapp-status";

// Dashboard (A2): destino al entrar. Todos lo ven completo, "Gasto de IA"
// incluido (todos registran recargas, el vendedor también) y, desde la
// Fase E, hasta arriba. Los datos se calculan en el servidor para la organización de la
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
  const [cards, series, breakdown, spend, railway, whatsapp, bot, stages, followUps, followUpsReal] = await Promise.all([
    newConversationsCards(db, organizationId),
    newConversationsByDay(db, organizationId, range),
    newConversationsBreakdown(db, organizationId, range),
    canSeeSpend ? aiSpendSummary(db, organizationId) : null,
    // Cobro de Railway (lo lee el worker cada 5 min); null sin token: no hay tarjeta.
    canSeeSpend ? railwaySummary(db, organizationId) : null,
    // Alarma de desconexión: lo último que guardó el monitoreo (no llama a Zernio).
    loadWhatsappStatus(db, organizationId),
    // ¿El bot contesta? Solo datos del CRM (canal, horario, chats sin respuesta).
    loadBotStatus(organizationId),
    listFunnelStages(organizationId),
    // Seguimientos del Agente IA en el periodo (Parte 4).
    followUpStats(db, organizationId, range),
    followUpsRealFor(organizationId),
  ]);

  const byStage = new Map(breakdown.porEtapa.map((b) => [b.clave, b.total]));
  const anuncioPct = breakdown.total > 0 ? Math.round((breakdown.porAnuncio / breakdown.total) * 100) : 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        {(whatsapp || bot) && (
          <div className="flex flex-wrap items-center gap-2">
            {whatsapp && <StatusPill status={whatsapp} title="Estado de WhatsApp" />}
            {bot && <StatusPill status={bot} title="Estado del Agente IA" />}
          </div>
        )}
      </div>

      {/* Fase E (decisión del dueño): el Gasto de IA va primero; el saldo importa más que las métricas. */}
      {spend && <AiSpendCard summary={spend} canRegister={roleAllows(role, "aiSpend", "update")} />}
      {railway && <RailwayCard summary={railway} />}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Conversaciones nuevas</h2>
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
          rows={stages.map((stage) => ({ label: stage.name, total: byStage.get(stage.key) ?? 0 }))}
          action={
            // 9-oct-2026 (dueño): cada cambio de etapa, quién y cuándo, en su propia página.
            <Link href="/inicio/etapas" className="-my-1 rounded border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
              Historial
            </Link>
          }
        />
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Llegaron por anuncio</h2>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{breakdown.porAnuncio}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            de {breakdown.total} en el periodo ({anuncioPct}%)
          </p>
        </div>
      </div>

      <FollowUpCard stats={followUps} ensayo={!followUpsReal} />
    </div>
  );
}
