import { requireActiveMembership } from "@/lib/auth/active-organization";
import { listAdsForPeriod } from "@/lib/ads/queries";
import { resolveRange } from "@/lib/dashboard/range";
import { AdsTable, type AdRow } from "@/components/anuncios/ads-table";
import { RangeFilter } from "../inicio/_components/range-filter";

// Sección "Anuncios": anuncios de Meta que trajeron clientes en el periodo
// (tabla de components/anuncios, contrato en docs/ui-anuncios-tabla.md). Todos
// los miembros la ven: la tarjeta del chat lleva aquí. El clic en la fila abre
// la página del anuncio.
export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function AnunciosPage({ searchParams }: PageProps<"/anuncios">) {
  const { organizationId } = await requireActiveMembership();
  const params = await searchParams;
  const range = resolveRange({ mes: param(params.mes), desde: param(params.desde), hasta: param(params.hasta) });
  const ads = await listAdsForPeriod(organizationId, range);
  const rows: AdRow[] = ads.map((ad) => ({
    adKey: ad.key,
    adId: ad.adId ?? "",
    name: ad.name,
    thumbnailUrl: ad.thumbnailUrl,
    metaUrl: ad.metaUrl,
    // Sin nombres de Meta aún (token, error o ficha sin id): "—".
    campaignName: ad.campaignName ?? "—",
    adsetName: ad.adsetName ?? "",
    status: ad.status,
    // Llega con "Métricas de anuncios" (Insights de Meta).
    linkClicks: null,
    clients: ad.clients,
    bought: ad.bought,
  }));

  return (
    // Alto fijo (la barra mide 4rem): la tabla se desliza por dentro y la página no.
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Anuncios</h1>
          <p className="text-xs text-muted-foreground">
            Anuncios de Meta por los que llegaron clientes a WhatsApp en el periodo (por la fecha de su clic).
          </p>
        </div>
        <RangeFilter key={`${range.desde}_${range.hasta}`} mes={range.mes} desde={range.desde} hasta={range.hasta} basePath="/anuncios" />
      </header>
      <AdsTable rows={rows} emptyMessage="Ningún cliente llegó por un anuncio en este periodo." className="min-h-0 flex-1" />
    </div>
  );
}
