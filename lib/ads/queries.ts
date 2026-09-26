// Consultas de la sección "Anuncios", la tarjeta del chat y el Detalle del
// contacto. Toda consulta filtra por organización. La UI recibe el dato listo
// (nombres ya resueltos: Meta → titular de la ficha → "Anuncio").
//
// Métricas completas (gasto contra ventas, conjuntos, clics en el enlace…) son
// una fase posterior ("Métricas de anuncios") que se monta sobre estas mismas
// tablas y con las MISMAS reglas de conteo (ver listAdsForPeriod).
import { and, asc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { adClicks, contacts, messages, metaAds } from "@/lib/db/schema";
import { DASHBOARD_TIME_ZONE, type DateRange } from "@/lib/dashboard/range";
import { adHrefOf, adKeyOf, adKeySql, isAdKey } from "./ad-key";
import { adsManagerUrl, storyUrl } from "./meta-api";
import { adStatusOf, type AdStatus } from "./ad-status";
import { httpsUrl, normalizeReferral } from "./referral";

type MetaRow = typeof metaAds.$inferSelect;

/** Nombre visible: el de Meta; si aún no se consultó (o falló), el titular de la ficha. */
export function adDisplayName(meta: Pick<MetaRow, "adName" | "creativeTitle"> | null | undefined, headline: string | null, adId: string | null): string {
  return meta?.adName ?? headline ?? meta?.creativeTitle ?? (adId ? `Anuncio ${adId}` : "Anuncio sin identificar");
}

/**
 * Miniatura del anuncio: la ÚNICA copia chica guardada en el bucket propio
 * (nunca links de Meta, que caducan). Sin miniatura aún → null (la UI pone un ícono).
 */
export function thumbnailOf(meta: Pick<MetaRow, "adId" | "thumbnailKey"> | null | undefined): string | null {
  return meta?.thumbnailKey ? `/api/ads/thumbnail/${encodeURIComponent(meta.adId)}` : null;
}

async function metaFor(organizationId: string, adIds: string[]): Promise<Map<string, MetaRow>> {
  if (adIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(metaAds)
    .where(and(eq(metaAds.organizationId, organizationId), inArray(metaAds.adId, adIds)));
  return new Map(rows.map((r) => [r.adId, r]));
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
  const out = new Map<string, AdCard>();
  for (const c of clicks) {
    const meta = c.adId ? metas.get(c.adId) : undefined;
    out.set(c.messageId!, {
      name: adDisplayName(meta, c.headline, c.adId),
      href: adHrefOf(c),
      thumbnailUrl: thumbnailOf(meta),
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
  // Sin clic registrado no hay página aún (el barrido lo registra): con id, su
  // página; sin id, la lista de anuncios.
  return {
    name: adDisplayName(null, data.headline, data.adId),
    href: data.adId ? `/anuncios/${data.adId}` : "/anuncios",
    thumbnailUrl: null,
    mediaType: data.mediaType,
  };
}

// ─── Qué cuenta en las métricas ─────────────────────────────────────────────

// Igual que el Dashboard (docs/numero-prueba.md): nada que entre por un canal de
// PRUEBA ni de un contacto de prueba cuenta. `c` = ad_clicks, `ct` = contacts.
const countedJoins = sql`
  join ${contacts} ct on ct.id = c.contact_id and ct.organization_id = c.organization_id and not ct.es_prueba
  join conversations cv on cv.id = c.conversation_id and cv.organization_id = c.organization_id
  join channels ch on ch.id = cv.channel_id and not ch.is_test`;

// Día local (America/Mazatlan) → instante UTC sin zona de su medianoche, para
// comparar contra clicked_at crudo (la ingesta lo escribe desde JS en UTC).
function localDayStartUtc(day: string, plusDays = 0): SQL {
  return sql`(((${day}::date + ${plusDays}::int)::timestamp at time zone ${DASHBOARD_TIME_ZONE}) at time zone 'UTC')`;
}

function adKeyMatches(key: string): SQL {
  // Con id de Meta usa el índice (organization_id, ad_id, clicked_at).
  return /^\d+$/.test(key) ? sql`c.ad_id = ${key}` : sql`${adKeySql("c")} = ${key}`;
}

// ─── Tabla de anuncios (sección "Anuncios") ─────────────────────────────────

/** Fila de la tabla (components/anuncios/ads-table.tsx, `AdRow`, la arma la página). */
export type AdPeriodItem = {
  key: string;
  adId: string | null;
  name: string;
  campaignName: string | null;
  adsetName: string | null;
  status: AdStatus;
  thumbnailUrl: string | null;
  metaUrl: string | null;
  clients: number;
  bought: number;
};

// Tope de filas por consulta: la tabla se virtualiza a partir de 100; una PyME
// tiene decenas de anuncios con clientes por periodo.
export const ADS_TABLE_LIMIT = 2_000;

/**
 * Anuncios con clientes en el periodo (días locales de Mazatlán, inclusivos).
 * - Clientes = contactos DISTINTOS con al menos un clic de ese anuncio cuya
 *   fecha cae en el periodo (un cliente que vuelve por el mismo anuncio cuenta una vez).
 * - Compraron = de esos, los que HOY están en la etapa Compra.
 * - Un contacto que llegó por 2 anuncios cuenta en AMBOS (cada anuncio lo trajo);
 *   por eso la suma de la columna puede pasar del total de contactos del periodo.
 * - Contacto sin anuncio: no aparece (no tiene clic).
 */
export async function listAdsForPeriod(organizationId: string, range: DateRange, now: Date = new Date()): Promise<AdPeriodItem[]> {
  const rows = await db.execute<{
    key: string;
    ad_id: string | null;
    clients: number;
    bought: number;
    headline: string | null;
  }>(sql`
    select ${adKeySql("c")} as key,
           max(c.ad_id) as ad_id,
           count(distinct c.contact_id)::int as clients,
           count(distinct c.contact_id) filter (where ct.stage = 'compra')::int as bought,
           (array_agg(c.headline order by c.clicked_at desc, c.id) filter (where c.headline is not null))[1] as headline
      from ${adClicks} c
      ${countedJoins}
     where c.organization_id = ${organizationId}
       and c.clicked_at >= ${localDayStartUtc(range.desde)}
       and c.clicked_at < ${localDayStartUtc(range.hasta, 1)}
     group by 1
     order by clients desc, key
     limit ${ADS_TABLE_LIMIT}`);
  const adIds = rows.map((r) => r.ad_id).filter((id): id is string => id !== null);
  const metas = await metaFor(organizationId, adIds);
  return rows.map((r) => {
    const meta = r.ad_id ? metas.get(r.ad_id) : undefined;
    return {
      key: r.key,
      adId: r.ad_id,
      name: adDisplayName(meta, r.headline, r.ad_id),
      campaignName: meta?.campaignName ?? null,
      adsetName: meta?.adsetName ?? null,
      status: adStatusOf(meta, now),
      thumbnailUrl: thumbnailOf(meta),
      metaUrl: r.ad_id ? (meta?.adsManagerUrl ?? adsManagerUrl(r.ad_id, meta?.accountId ?? null)) : null,
      clients: Number(r.clients),
      bought: Number(r.bought),
    };
  });
}

// ─── Página del anuncio ─────────────────────────────────────────────────────

/** Clientes por página en la lista de la página del anuncio. */
export const AD_PEOPLE_PAGE_SIZE = 50;

export type AdDetail = {
  key: string;
  adId: string | null;
  name: string;
  campaignName: string | null;
  adsetName: string | null;
  status: string | null;
  title: string | null;
  body: string | null;
  /** Llamada a la acción (texto legible) y enlace del creativo. */
  cta: string | null;
  linkUrl: string | null;
  /** Solo los datos del video (el archivo se ve en Meta). */
  video: { id: string; title: string | null; lengthSeconds: number | null } | null;
  mediaType: string | null;
  thumbnailUrl: string | null;
  /** Totales de SIEMPRE (no del periodo de la tabla), sin canales ni contactos de prueba. */
  clients: number;
  bought: number;
  metaUrl: string | null;
  postUrl: string | null;
  /** Error de la última consulta a Meta (se muestra discreto: "nombres pendientes"). */
  metaPending: boolean;
  /** Una página de clientes (el más reciente primero); `clients` es el total. */
  people: { contactId: string; name: string; stage: string; clickedAt: Date }[];
  page: number;
  pageCount: number;
};

export async function getAd(organizationId: string, key: string, { page = 1 }: { page?: number } = {}): Promise<AdDetail | null> {
  if (!isAdKey(key)) return null;
  const adId = /^\d+$/.test(key) ? key : null;
  // Existencia y lo que se muestra del anuncio: con TODOS sus clics (también de
  // prueba: la tarjeta del chat de una prueba abre esta página).
  const [summary] = await db.execute<{
    clicks: number;
    media_type: string | null;
    headline: string | null;
    body: string | null;
    source_url: string | null;
  }>(sql`
    select count(*)::int as clicks,
           (array_agg(c.media_type order by c.clicked_at desc, c.id) filter (where c.media_type is not null))[1] as media_type,
           (array_agg(c.headline order by c.clicked_at desc, c.id) filter (where c.headline is not null or c.body is not null))[1] as headline,
           (array_agg(c.body order by c.clicked_at desc, c.id) filter (where c.headline is not null or c.body is not null))[1] as body,
           (array_agg(c.source_url order by c.clicked_at desc, c.id) filter (where c.source_url is not null))[1] as source_url
      from ${adClicks} c
     where c.organization_id = ${organizationId} and ${adKeyMatches(key)}`);
  if (!summary || Number(summary.clicks) === 0) return null;

  const [totals] = await db.execute<{ clients: number; bought: number }>(sql`
    select count(distinct c.contact_id)::int as clients,
           count(distinct c.contact_id) filter (where ct.stage = 'compra')::int as bought
      from ${adClicks} c
      ${countedJoins}
     where c.organization_id = ${organizationId} and ${adKeyMatches(key)}`);
  const clients = Number(totals?.clients ?? 0);
  const pageCount = Math.max(1, Math.ceil(clients / AD_PEOPLE_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);

  // Una persona una vez (su entrada más reciente por este anuncio), por páginas.
  const people = await db.execute<{ contact_id: string; first_name: string | null; last_name: string | null; stage: string; clicked_ms: string }>(sql`
    select p.contact_id, p.first_name, p.last_name, p.stage,
           (extract(epoch from p.clicked_at) * 1000)::bigint as clicked_ms
      from (
        select distinct on (c.contact_id) c.contact_id, ct.first_name, ct.last_name, ct.stage, c.clicked_at
          from ${adClicks} c
          ${countedJoins}
         where c.organization_id = ${organizationId} and ${adKeyMatches(key)}
         order by c.contact_id, c.clicked_at desc
      ) p
     order by p.clicked_at desc, p.contact_id
     limit ${AD_PEOPLE_PAGE_SIZE} offset ${(current - 1) * AD_PEOPLE_PAGE_SIZE}`);

  const meta = adId ? (await metaFor(organizationId, [adId])).get(adId) : undefined;
  return {
    key,
    adId,
    name: adDisplayName(meta, summary.headline, adId),
    campaignName: meta?.campaignName ?? null,
    adsetName: meta?.adsetName ?? null,
    status: meta?.effectiveStatus ?? null,
    title: meta?.creativeTitle ?? summary.headline ?? null,
    body: meta?.creativeBody ?? summary.body ?? null,
    cta: ctaLabel(meta?.ctaType ?? null),
    linkUrl: httpsUrl(meta?.linkUrl ?? null),
    video: meta?.videoId ? { id: meta.videoId, title: meta.videoTitle, lengthSeconds: meta.videoLengthSeconds } : null,
    mediaType: meta?.videoId ? "video" : (summary.media_type ?? null),
    thumbnailUrl: thumbnailOf(meta),
    clients,
    bought: Number(totals?.bought ?? 0),
    metaUrl: adId ? (meta?.adsManagerUrl ?? adsManagerUrl(adId, meta?.accountId ?? null)) : null,
    postUrl: storyUrl(meta?.storyId ?? null) ?? httpsUrl(meta?.postUrl ?? null) ?? httpsUrl(summary.source_url ?? null),
    metaPending: Boolean(adId && (!meta?.fetchedAt || meta.fetchError)),
    people: people.map((p) => ({
      contactId: p.contact_id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      stage: p.stage,
      clickedAt: new Date(Number(p.clicked_ms)),
    })),
    page: current,
    pageCount,
  };
}

const CTA_LABELS: Record<string, string> = {
  WHATSAPP_MESSAGE: "Enviar mensaje de WhatsApp",
  MESSAGE_PAGE: "Enviar mensaje",
  LEARN_MORE: "Más información",
  SHOP_NOW: "Comprar",
  SIGN_UP: "Registrarte",
  CONTACT_US: "Contáctanos",
  GET_QUOTE: "Obtener cotización",
  CALL_NOW: "Llamar",
};

/** Llamada a la acción de Meta en texto legible (la desconocida, tal cual). */
export function ctaLabel(type: string | null): string | null {
  if (!type) return null;
  return CTA_LABELS[type] ?? type.toLowerCase().replace(/_/g, " ");
}

// ─── Detalle del contacto ───────────────────────────────────────────────────

export type ContactAdRef = { adId: string | null; name: string; href: string; clickedAt: Date };

/** Primer anuncio por el que llegó el contacto y los demás por los que volvió (distintos). */
export async function contactAdAttribution(
  organizationId: string,
  contactId: string,
): Promise<{ first: ContactAdRef; others: ContactAdRef[] } | null> {
  const clicks = await db
    .select({
      id: adClicks.id,
      adId: adClicks.adId,
      sourceUrl: adClicks.sourceUrl,
      headline: adClicks.headline,
      body: adClicks.body,
      clickedAt: adClicks.clickedAt,
    })
    .from(adClicks)
    .where(and(eq(adClicks.organizationId, organizationId), eq(adClicks.contactId, contactId)))
    .orderBy(asc(adClicks.clickedAt));
  if (clicks.length === 0) return null;
  const metas = await metaFor(organizationId, clicks.map((c) => c.adId).filter((id): id is string => id !== null));
  const refs = clicks.map((c) => ({
    key: adKeyOf(c),
    ref: {
      adId: c.adId,
      name: adDisplayName(c.adId ? metas.get(c.adId) : undefined, c.headline, c.adId),
      href: adHrefOf(c),
      clickedAt: c.clickedAt,
    },
  }));
  const [first, ...rest] = refs;
  const seen = new Set([first.key]);
  const others: ContactAdRef[] = [];
  // La vuelta más reciente de cada anuncio distinto.
  for (const r of rest.reverse()) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    others.push(r.ref);
  }
  return { first: first.ref, others };
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

