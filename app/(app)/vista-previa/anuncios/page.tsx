import { notFound } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { resolveRange } from "@/lib/dashboard/range";
import { AdsTable, type AdRow } from "@/components/anuncios/ads-table";
import { RangeFilter } from "../../inicio/_components/range-filter";

// VISTA PREVIA de la tabla de anuncios con datos de EJEMPLO, para que el dueño
// la revise antes de conectarla a datos reales (bloque "Anuncios de Meta"). Solo
// owner/admin y solo FUERA de producción (ahí responde 404). Se borra cuando la
// tabla reemplace la lista de /anuncios.
export const dynamic = "force-dynamic";

const SAMPLE: AdRow[] = [
  { adKey: "a1", adId: "120250001", name: "Compuerta a la medida — temporada de lluvias", thumbnailUrl: "https://picsum.photos/seed/diluvium1/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Lluvias 2026 — Sinaloa", adsetName: "Culiacán 25-55", status: "active", linkClicks: null, clients: 48, bought: 9 },
  { adKey: "a2", adId: "120250002", name: "Testimonio: así protegió su casa", thumbnailUrl: "https://picsum.photos/seed/diluvium2/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Lluvias 2026 — Sinaloa", adsetName: "Los Mochis 30-60", status: "active", linkClicks: null, clients: 31, bought: 4 },
  { adKey: "a3", adId: "120250003", name: "Video: instalación en 2 horas", thumbnailUrl: null, metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Lluvias 2026 — Sinaloa", adsetName: "Mazatlán 25-55", status: "paused", linkClicks: null, clients: 12, bought: 1 },
  { adKey: "a4", adId: "120250004", name: "Mini compuerta para cocheras", thumbnailUrl: "https://picsum.photos/seed/diluvium4/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Mini compuertas", adsetName: "Guasave 30-65", status: "active", linkClicks: null, clients: 27, bought: 6 },
  { adKey: "a5", adId: "120250005", name: "¿Cuánto cuesta? Cotiza sin compromiso", thumbnailUrl: "https://picsum.photos/seed/diluvium5/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Mini compuertas", adsetName: "Culiacán 25-55", status: "active", linkClicks: null, clients: 0, bought: 0 },
  { adKey: "a6", adId: "120250006", name: "Tapones inflables para bajadas", thumbnailUrl: "https://picsum.photos/seed/diluvium6/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Tapones", adsetName: "Sinaloa amplio", status: "paused", linkClicks: null, clients: 8, bought: 2 },
  { adKey: "a7", adId: "120250007", name: "Garantía de 5 años", thumbnailUrl: "https://picsum.photos/seed/diluvium7/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Tapones", adsetName: "Mazatlán 25-55", status: "active", linkClicks: null, clients: 19, bought: 3 },
  { adKey: "a8", adId: "120250008", name: "Antes y después: cochera inundada", thumbnailUrl: "https://picsum.photos/seed/diluvium8/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Lluvias 2026 — Sinaloa", adsetName: "Culiacán 25-55", status: "active", linkClicks: null, clients: 55, bought: 11 },
  { adKey: "a9", adId: "120250009", name: "Instalación sin obra", thumbnailUrl: "https://picsum.photos/seed/diluvium9/80", metaUrl: null, campaignName: "Mini compuertas", adsetName: "Los Mochis 30-60", status: "paused", linkClicks: null, clients: 5, bought: 0 },
  { adKey: "a10", adId: "120250010", name: "Ñandú y Peña: nombres con acentos para probar el buscador", thumbnailUrl: "https://picsum.photos/seed/diluvium10/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Campaña de prueba", adsetName: "Conjunto Ñ", status: "unknown", linkClicks: null, clients: 3, bought: 1 },
  { adKey: "a11", adId: "120250011", name: "Meses sin intereses", thumbnailUrl: "https://picsum.photos/seed/diluvium11/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Tapones", adsetName: "Guasave 30-65", status: "active", linkClicks: null, clients: 14, bought: 2 },
  { adKey: "a12", adId: "120250012", name: "Medidas especiales para zaguanes", thumbnailUrl: "https://picsum.photos/seed/diluvium12/80", metaUrl: "https://www.facebook.com/adsmanager", campaignName: "Lluvias 2026 — Sinaloa", adsetName: "Mazatlán 25-55", status: "active", linkClicks: null, clients: 22, bought: 7 },
];

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function VistaPreviaAnunciosPage({ searchParams }: PageProps<"/vista-previa/anuncios">) {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") notFound();
  const { role } = await requireActiveMembership();
  if (!roleAllows(role, "aiConfig", "read")) notFound();
  const params = await searchParams;
  const range = resolveRange({ mes: param(params.mes), desde: param(params.desde), hasta: param(params.hasta) });

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Anuncios · vista previa</h1>
          <p className="text-xs text-muted-foreground">
            Datos de EJEMPLO para revisar la tabla. Los reales se conectan en el bloque “Anuncios de Meta”. El periodo se elige, pero aún no filtra.
          </p>
        </div>
        <RangeFilter key={`${range.desde}_${range.hasta}`} mes={range.mes} desde={range.desde} hasta={range.hasta} basePath="/vista-previa/anuncios" />
      </header>
      <AdsTable rows={SAMPLE} className="min-h-0 flex-1" />
    </div>
  );
}
