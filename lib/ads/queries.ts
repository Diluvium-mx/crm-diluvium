// Consultas de la sección "Anuncios", la tarjeta del chat y el Detalle del
// contacto. Toda consulta filtra por organización. La UI recibe el dato listo
// (nombres ya resueltos: Meta → titular de la ficha → "Anuncio").
//
// Métricas completas (gasto contra ventas, conjuntos, activos…) son una fase
// posterior ("Métricas de anuncios") que se monta sobre estas mismas tablas.
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adClicks, contacts, messages, metaAds } from "@/lib/db/schema";
import { adHrefOf, adKeyOf, adKeySql, isAdKey } from "./ad-key";
import { adsManagerUrl, storyUrl } from "./meta-api";
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
    key: string;
    ad_id: string | null;
    clients: number;
    bought: number;
    last_click_ms: string;
    headline: string | null;
    media_type: string | null;
  }>(sql`
    select ${adKeySql("c")} as key,
           max(c.ad_id) as ad_id,
           count(distinct c.contact_id)::int as clients,
           count(distinct c.contact_id) filter (where ct.stage = 'compra')::int as bought,
           -- clicked_at lo escribe la ingesta desde JS (UTC, sin zona): epoch sin conversión.
           (extract(epoch from max(c.clicked_at)) * 1000)::bigint as last_click_ms,
           (array_agg(c.headline order by c.clicked_at desc) filter (where c.headline is not null))[1] as headline,
           (array_agg(c.media_type order by c.clicked_at desc) filter (where c.media_type is not null))[1] as media_type
      from ${adClicks} c
      join ${contacts} ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
     where c.organization_id = ${organizationId}
     group by 1
     order by max(c.clicked_at) desc`);
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
      clients: Number(r.clients),
      bought: Number(r.bought),
      lastClickAt: new Date(Number(r.last_click_ms)),
      thumbnailUrl: thumbnailOf(meta),
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
  /** Llamada a la acción (texto legible) y enlace del creativo. */
  cta: string | null;
  linkUrl: string | null;
  /** Solo los datos del video (el archivo se ve en Meta). */
  video: { id: string; title: string | null; lengthSeconds: number | null } | null;
  mediaType: string | null;
  thumbnailUrl: string | null;
  clients: number;
  bought: number;
  metaUrl: string | null;
  postUrl: string | null;
  /** Error de la última consulta a Meta (se muestra discreto: "nombres pendientes"). */
  metaPending: boolean;
  people: { contactId: string; name: string; stage: string; clickedAt: Date }[];
};

export async function getAd(organizationId: string, key: string): Promise<AdDetail | null> {
  if (!isAdKey(key)) return null;
  const adId = /^\d+$/.test(key) ? key : null;
  const byAd = adId !== null ? eq(adClicks.adId, adId) : sql`${adKeySql()} = ${key}`;
  const clicks = await db
    .select({ click: adClicks, contact: { id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, stage: contacts.stage } })
    .from(adClicks)
    .innerJoin(contacts, and(eq(contacts.id, adClicks.contactId), eq(contacts.organizationId, adClicks.organizationId)))
    .where(and(eq(adClicks.organizationId, organizationId), byAd))
    .orderBy(desc(adClicks.clickedAt));
  if (clicks.length === 0) return null;
  const meta = adId ? (await metaFor(organizationId, [adId])).get(adId) : undefined;
  const withMediaType = clicks.find((c) => c.click.mediaType)?.click;
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
    cta: ctaLabel(meta?.ctaType ?? null),
    linkUrl: httpsUrl(meta?.linkUrl ?? null),
    video: meta?.videoId ? { id: meta.videoId, title: meta.videoTitle, lengthSeconds: meta.videoLengthSeconds } : null,
    mediaType: meta?.videoId ? "video" : (withMediaType?.mediaType ?? null),
    thumbnailUrl: thumbnailOf(meta),
    clients: list.length,
    bought: list.filter((p) => p.stage === "compra").length,
    metaUrl: adId ? (meta?.adsManagerUrl ?? adsManagerUrl(adId, meta?.accountId ?? null)) : null,
    postUrl: storyUrl(meta?.storyId ?? null) ?? httpsUrl(meta?.postUrl ?? null) ?? httpsUrl(withUrl?.sourceUrl ?? null),
    metaPending: Boolean(adId && (!meta?.fetchedAt || meta.fetchError)),
    people: list,
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

