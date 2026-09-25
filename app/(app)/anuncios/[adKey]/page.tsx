import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { getAd } from "@/lib/ads/queries";
import { STAGE_LABELS, type Stage } from "../../contactos/_data/types";

// Página de un anuncio: Campaña › Conjunto › Anuncio, su miniatura (una sola
// copia chica; el video se ve en Meta), el texto, la llamada a la acción, cuántos
// clientes llegaron por él, cuántos compraron (etapa Compra) y los enlaces a Meta.
const DATE = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function AnuncioPage({ params }: PageProps<"/anuncios/[adKey]">) {
  const { adKey } = await params;
  const { organizationId } = await requireActiveMembership();
  const ad = await getAd(organizationId, adKey);
  if (!ad) notFound();

  const trail = [ad.campaignName, ad.adsetName].filter(Boolean);
  const videoLength = ad.video?.lengthSeconds ? `${Math.round(ad.video.lengthSeconds)} s` : null;
  return (
    <>
      <div>
        <Link href="/anuncios" className="text-xs text-muted-foreground hover:underline">
          ← Anuncios
        </Link>
        <nav aria-label="Campaña, conjunto y anuncio" className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {trail.map((t) => (
            <span key={t}>
              {t} <span aria-hidden>›</span>
            </span>
          ))}
        </nav>
        <h1 className="text-lg font-semibold">{ad.name}</h1>
        {ad.metaPending && ad.adId && (
          <p className="text-[11px] text-muted-foreground">Nombres de Meta pendientes: se muestra lo que trajo el mensaje.</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-4">
          {ad.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.thumbnailUrl} alt={ad.name} className="max-h-80 w-auto max-w-full rounded-md object-contain" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center rounded-md bg-brand-orange/10 text-5xl" aria-hidden>
              {ad.mediaType === "video" ? "🎬" : "📣"}
            </div>
          )}
          {ad.video && (
            <p className="text-center text-xs text-muted-foreground">
              🎬 Anuncio de video{ad.video.title ? ` · ${ad.video.title}` : ""}
              {videoLength ? ` · ${videoLength}` : ""}
              {ad.metaUrl ? " · se ve en Meta" : ""}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-3xl font-semibold tabular-nums">{ad.clients}</p>
              <p className="text-xs text-muted-foreground">{ad.clients === 1 ? "cliente llegó" : "clientes llegaron"} por este anuncio</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-3xl font-semibold tabular-nums">{ad.bought}</p>
              <p className="text-xs text-muted-foreground">{ad.bought === 1 ? "compró" : "compraron"} (etapa Compra)</p>
            </div>
          </div>

          {(ad.title || ad.body || ad.cta || ad.linkUrl) && (
            <div className="rounded-lg border bg-card p-4">
              {ad.title && <p className="text-sm font-semibold">{ad.title}</p>}
              {ad.body && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{ad.body}</p>}
              {(ad.cta || ad.linkUrl) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {ad.cta && <span>Botón: {ad.cta}</span>}
                  {ad.cta && ad.linkUrl && " · "}
                  {ad.linkUrl && (
                    <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                      {ad.linkUrl.replace(/^https:\/\//, "").slice(0, 60)}
                    </a>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {ad.metaUrl && (
              <a href={ad.metaUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
                Ver en Meta
              </a>
            )}
            {ad.postUrl && (
              <a href={ad.postUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                Ver publicación
              </a>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-lg border bg-card">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">Clientes que llegaron por este anuncio</h2>
        <ul className="divide-y">
          {ad.people.map((p) => (
            <li key={p.contactId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                <span className={p.stage === "compra" ? "font-medium text-emerald-700 dark:text-emerald-300" : ""}>
                  {STAGE_LABELS[p.stage as Stage] ?? p.stage}
                </span>
                <span>{DATE.format(p.clickedAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
