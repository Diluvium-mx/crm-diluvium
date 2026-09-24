// Consultas de la sección "Anuncios", la tarjeta del chat y el Detalle del
// contacto. Toda consulta filtra por organización. La UI recibe el dato listo
// (nombres ya resueltos: Meta → titular de la ficha → "Anuncio").
//
// Métricas completas (gasto contra ventas, conjuntos, activos…) son una fase
// posterior ("Métricas de anuncios") que se monta sobre estas mismas tablas.
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adClicks, contacts, messages, metaAds, type AdMediaItem } from "@/lib/db/schema";
import { adsManagerUrl, storyUrl } from "./meta-api";
import { httpsUrl, normalizeReferral } from "./referral";

/** Clave de la página de un anuncio: su id de Meta, o "sin-id" para las fichas sin él. */
export const NO_AD_ID_KEY = "sin-id";

export function adKey(adId: string | null): string {
  return adId ?? NO_AD_ID_KEY;
}

export function adHref(adId: string | null): string {
  return `/anuncios/${adKey(adId)}`;
}

type MetaRow = typeof metaAds.$inferSelect;

/** Nombre visible: el de Meta; si aún no se consultó (o falló), el titular de la ficha. */
export function adDisplayName(meta: Pick<MetaRow, "adName" | "creativeTitle"> | null | undefined, headline: string | null, adId: string | null): string {
  return meta?.adName ?? headline ?? meta?.creativeTitle ?? (adId ? `Anuncio ${adId}` : "Anuncio sin identificar");
}

export type AdVisual = { thumbnailUrl: string | null; imageUrl: string | null; videoUrl: string | null };

function stored(media: AdMediaItem[], role: AdMediaItem["role"]): boolean {
  return media.some((m) => m.role === role && m.storageKey);
}

/**
 * Qué mostrar (solo lo que ya está en el bucket propio, nunca links de Meta
 * que caducan): primero la ficha del clic, luego el creativo de la API.
 */
export function pickVisual(
  click: { id: string; media: AdMediaItem[] } | null,
  ad: { adId: string; media: AdMediaItem[] } | null,
): AdVisual {
  const fromClick = (role: AdMediaItem["role"]) =>
    click && stored(click.media, role) ? `/api/ads/media/click/${encodeURIComponent(click.id)}/${role}` : null;
  const fromAd = (role: AdMediaItem["role"]) =>
    ad && stored(ad.media, role) ? `/api/ads/media/ad/${encodeURIComponent(ad.adId)}/${role}` : null;
  const imageUrl = fromClick("image") ?? fromAd("image");
  return {
    thumbnailUrl: fromClick("thumbnail") ?? fromClick("image") ?? fromAd("thumbnail") ?? imageUrl,
    imageUrl,
    videoUrl: fromClick("video") ?? fromAd("video"),
  };
}

async function metaFor(organizationId: string, adIds: string[]): Promise<Map<string, MetaRow>> {
  if (adIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(metaAds)
    .where(and(eq(metaAds.organizationId, organizationId), inArray(metaAds.adId, adIds)));
  return new Map(rows.map((r) => [r.adId, r]));
}

/** El clic más reciente de cada anuncio que ya tiene media en el bucket (para la miniatura). */
async function latestStoredClicks(organizationId: string, adIds: (string | null)[]) {
  const keys = [...new Set(adIds.map(adKey))];
  if (keys.length === 0) return new Map<string, { id: string; media: AdMediaItem[] }>();
  const rows = await db.execute<{ key: string; id: string; media: AdMediaItem[] }>(sql`
    select distinct on (t.key) t.key, t.id, t.media
      from (select coalesce(ad_id, ${NO_AD_ID_KEY}) as key, id, media, clicked_at
              from ${adClicks}
             where organization_id = ${organizationId}
               and exists (select 1 from jsonb_array_elements(media) m where m->>'storageKey' is not null)) t
     where t.key in ${keys}
     order by t.key, t.clicked_at desc`);
  return new Map(rows.map((r) => [r.key, { id: r.id, media: r.media }]));
}

// ─── Tarjeta del chat ───────────────────────────────────────────────────────

export type AdCard = {
  name: string;
  href: string;
  thumbnailUrl: string | null;
  mediaType: string | null;
};

/** Tarjeta compacta por mensaje (el que trajo la ficha o al que se atribuyó el respaldo). */
export async function adCardsForMessages(organizationId: string, messageIds: string[]): Promise<Map<string, AdCard>> {
  if (messageIds.length === 0) return new Map();
  const clicks = await db
    .select()
    .from(adClicks)
    .where(and(eq(adClicks.organizationId, organizationId), inArray(adClicks.messageId, messageIds)));
  if (clicks.length === 0) return new Map();
  const metas = await metaFor(organizationId, clicks.map((c) => c.adId).filter((id): id is string => id !== null));
  const siblings = await latestStoredClicks(organizationId, clicks.map((c) => c.adId));
  const out = new Map<string, AdCard>();
  for (const c of clicks) {
    const meta = c.adId ? metas.get(c.adId) : undefined;
    const ownOrSibling = c.media.some((m) => m.storageKey) ? c : (siblings.get(adKey(c.adId)) ?? null);
    const visual = pickVisual(ownOrSibling, meta ? { adId: meta.adId, media: meta.creativeMedia } : null);
    out.set(c.messageId!, {
      name: adDisplayName(meta, c.headline, c.adId),
      href: adHref(c.adId),
      thumbnailUrl: visual.thumbnailUrl,
      mediaType: c.mediaType,
    });
  }
  return out;
}

/**
 * Tarjeta mínima desde la ficha cruda del mensaje, para un mensaje con ficha
 * cuyo clic aún no está registrado (lo registra el barrido en ≤1 min). Sin
 * miniatura: los links de Meta caducan y nunca se muestran directo.
 */
export function adCardFromRaw(raw: Record<string, unknown> | null | undefined): AdCard | null {
  if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) return null;
  const data = normalizeReferral(raw);
  return { name: adDisplayName(null, data.headline, data.adId), href: adHref(data.adId), thumbnailUrl: null, mediaType: data.mediaType };
}

// ─── Lista de anuncios ──────────────────────────────────────────────────────

export type AdListItem = {
  key: string;
  adId: string | null;
  name: string;
  campaignName: string | null;
  adsetName: string | null;
  clients: number;
  bought: number;
  lastClickAt: Date;
  thumbnailUrl: string | null;
  mediaType: string | null;
};

export async function listAds(organizationId: string): Promise<AdListItem[]> {
  const rows = await db.execute<{
    ad_id: string | null;
    clients: number;
    bought: number;
    last_click_ms: string;
    headline: string | null;
    media_type: string | null;
  }>(sql`
    select c.ad_id,
           count(distinct c.contact_id)::int as clients,
           count(distinct c.contact_id) filter (where ct.stage = 'compra')::int as bought,
           -- clicked_at lo escribe la ingesta desde JS (UTC, sin zona): epoch sin conversión.
           (extract(epoch from max(c.clicked_at)) * 1000)::bigint as last_click_ms,
           (array_agg(c.headline order by c.clicked_at desc) filter (where c.headline is not null))[1] as headline,
           (array_agg(c.media_type order by c.clicked_at desc) filter (where c.media_type is not null))[1] as media_type
      from ${adClicks} c
      join ${contacts} ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
     where c.organization_id = ${organizationId}
     group by c.ad_id
     order by max(c.clicked_at) desc`);
  const adIds = rows.map((r) => r.ad_id).filter((id): id is string => id !== null);
  const [metas, clicks] = await Promise.all([metaFor(organizationId, adIds), latestStoredClicks(organizationId, rows.map((r) => r.ad_id))]);
  return rows.map((r) => {
    const meta = r.ad_id ? metas.get(r.ad_id) : undefined;
    const visual = pickVisual(clicks.get(adKey(r.ad_id)) ?? null, meta ? { adId: meta.adId, media: meta.creativeMedia } : null);
    return {
      key: adKey(r.ad_id),
      adId: r.ad_id,
      name: adDisplayName(meta, r.headline, r.ad_id),
      campaignName: meta?.campaignName ?? null,
      adsetName: meta?.adsetName ?? null,
      clients: Number(r.clients),
      bought: Number(r.bought),
      lastClickAt: new Date(Number(r.last_click_ms)),
      thumbnailUrl: visual.thumbnailUrl,
      mediaType: r.media_type,
    };
  });
}

// ─── Página del anuncio ─────────────────────────────────────────────────────

export type AdDetail = {
  key: string;
  adId: string | null;
  name: string;
  campaignName: string | null;
  adsetName: string | null;
  status: string | null;
  title: string | null;
  body: string | null;
  visual: AdVisual;
  clients: number;
  bought: number;
  metaUrl: string | null;
  postUrl: string | null;
  /** Error de la última consulta a Meta (se muestra discreto: "nombres pendientes"). */
  metaPending: boolean;
  people: { contactId: string; name: string; stage: string; clickedAt: Date }[];
};

export async function getAd(organizationId: string, key: string): Promise<AdDetail | null> {
  const adId = key === NO_AD_ID_KEY ? null : key;
  if (adId !== null && !/^\d{5,25}$/.test(adId)) return null;
  const byAd = adId === null ? sql`${adClicks.adId} is null` : eq(adClicks.adId, adId);
  const clicks = await db
    .select({ click: adClicks, contact: { id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, stage: contacts.stage } })
    .from(adClicks)
    .innerJoin(contacts, and(eq(contacts.id, adClicks.contactId), eq(contacts.organizationId, adClicks.organizationId)))
    .where(and(eq(adClicks.organizationId, organizationId), byAd))
    .orderBy(desc(adClicks.clickedAt));
  if (clicks.length === 0) return null;
  const meta = adId ? (await metaFor(organizationId, [adId])).get(adId) : undefined;
  const latestWithMedia = clicks.find((c) => c.click.media.some((m) => m.storageKey))?.click ?? null;
  const withText = clicks.find((c) => c.click.headline || c.click.body)?.click;
  const withUrl = clicks.find((c) => c.click.sourceUrl)?.click;

  // Una persona una vez (su entrada más reciente por este anuncio).
  const people = new Map<string, AdDetail["people"][number]>();
  for (const { click, contact } of clicks) {
    if (people.has(contact.id)) continue;
    people.set(contact.id, {
      contactId: contact.id,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
      stage: contact.stage,
      clickedAt: click.clickedAt,
    });
  }
  const list = [...people.values()];
  return {
    key,
    adId,
    name: adDisplayName(meta, withText?.headline ?? null, adId),
    campaignName: meta?.campaignName ?? null,
    adsetName: meta?.adsetName ?? null,
    status: meta?.effectiveStatus ?? null,
    title: meta?.creativeTitle ?? withText?.headline ?? null,
    body: meta?.creativeBody ?? withText?.body ?? null,
    visual: pickVisual(latestWithMedia, meta ? { adId: meta.adId, media: meta.creativeMedia } : null),
    clients: list.length,
    bought: list.filter((p) => p.stage === "compra").length,
    metaUrl: adId ? adsManagerUrl(adId, meta?.accountId ?? null) : null,
    postUrl: storyUrl(meta?.storyId ?? null) ?? httpsUrl(withUrl?.sourceUrl ?? null),
    metaPending: Boolean(adId && (!meta?.fetchedAt || meta.fetchError)),
    people: list,
  };
}

// ─── Detalle del contacto ───────────────────────────────────────────────────

export type ContactAdRef = { adId: string | null; name: string; href: string; clickedAt: Date };

/** Primer anuncio por el que llegó el contacto y los demás por los que volvió (distintos). */
export async function contactAdAttribution(
  organizationId: string,
  contactId: string,
): Promise<{ first: ContactAdRef; others: ContactAdRef[] } | null> {
  const clicks = await db
    .select({ adId: adClicks.adId, headline: adClicks.headline, clickedAt: adClicks.clickedAt })
    .from(adClicks)
    .where(and(eq(adClicks.organizationId, organizationId), eq(adClicks.contactId, contactId)))
    .orderBy(asc(adClicks.clickedAt));
  if (clicks.length === 0) return null;
  const metas = await metaFor(organizationId, clicks.map((c) => c.adId).filter((id): id is string => id !== null));
  const refs = clicks.map((c) => ({
    adId: c.adId,
    name: adDisplayName(c.adId ? metas.get(c.adId) : undefined, c.headline, c.adId),
    href: adHref(c.adId),
    clickedAt: c.clickedAt,
  }));
  const [first, ...rest] = refs;
  const seen = new Set([adKey(first.adId)]);
  const others: ContactAdRef[] = [];
  // La vuelta más reciente de cada anuncio distinto.
  for (const r of rest.reverse()) {
    if (seen.has(adKey(r.adId))) continue;
    seen.add(adKey(r.adId));
    others.push(r);
  }
  return { first, others };
}

// ─── Ventana gratis de 72 h (lib/ads/free-window.ts) ────────────────────────

/** Primera respuesta del NEGOCIO (humano, agente o app) que sí salió, desde la entrada por anuncio. */
export async function firstReplyAfter(organizationId: string, conversationId: string, entryAt: Date): Promise<Date | null> {
  const [reply] = await db
    .select({ at: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        inArray(messages.status, ["sent", "delivered", "read"]),
        // Un aviso interno (system_note, Fase D) nunca salió al cliente.
        sql`${messages.type}::text <> 'system_note'`,
        gte(messages.sentAt, entryAt),
      ),
    )
    .orderBy(asc(messages.sentAt))
    .limit(1);
  return reply?.at ?? null;
}

