import Link from "next/link";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { listAds } from "@/lib/ads/queries";
import { AdThumb } from "./_components/ad-thumb";

// Lista de anuncios que trajeron clientes (el más reciente arriba). Todos los
// miembros la ven: la tarjeta del chat lleva aquí.
const DATE = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function AnunciosPage() {
  const { organizationId } = await requireActiveMembership();
  const ads = await listAds(organizationId);

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold">Anuncios</h1>
        <p className="text-xs text-muted-foreground">Anuncios de Meta por los que llegaron clientes a WhatsApp.</p>
      </header>

      {ads.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          Aún no llega ningún cliente por un anuncio.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {ads.map((ad) => (
            <li key={ad.key}>
              <Link
                href={`/anuncios/${ad.key}`}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted"
              >
                <AdThumb src={ad.thumbnailUrl} mediaType={ad.mediaType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{ad.name}</p>
                  {(ad.campaignName || ad.adsetName) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[ad.campaignName, ad.adsetName].filter(Boolean).join(" › ")}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">Último cliente: {DATE.format(ad.lastClickAt)}</p>
                </div>
                <div className="flex shrink-0 gap-4 text-right">
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{ad.clients}</p>
                    <p className="text-[11px] text-muted-foreground">{ad.clients === 1 ? "cliente" : "clientes"}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{ad.bought}</p>
                    <p className="text-[11px] text-muted-foreground">{ad.bought === 1 ? "compró" : "compraron"}</p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
