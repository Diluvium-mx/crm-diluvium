// API de Marketing de Meta (Graph API): del id del anuncio (source_id de la
// ficha) a campaña, conjunto, nombre del anuncio y su creativo.
//
// Token: META_ADS_ACCESS_TOKEN (usuario del sistema del Business Manager con
// permiso ads_read sobre la cuenta publicitaria). Va en el encabezado
// Authorization, nunca en la URL (no queda en logs). Opcional:
// META_GRAPH_API_VERSION (por omisión v26.0, vigente desde el 29-jul-2026).
//
// Nunca frena nada: quien llama guarda el error y reintenta más tarde; la UI
// muestra lo que haya (la ficha del clic).
import { createHmac } from "node:crypto";

export const META_GRAPH_VERSION_DEFAULT = "v26.0";
const GRAPH_HOST = "https://graph.facebook.com";
const TIMEOUT_MS = 15_000;

export class MetaAdsNotConfiguredError extends Error {}

export class MetaApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** Token inválido/caducado o sin permiso: no se arregla reintentando pronto. */
  get isAuth(): boolean {
    return this.code === 190 || this.code === 10 || (this.code !== null && this.code >= 200 && this.code < 300);
  }

  /** Límite de uso de la API. */
  get isRateLimit(): boolean {
    return this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613 || this.code === 80004;
  }
}

export type MetaAdInfo = {
  adId: string;
  adName: string | null;
  effectiveStatus: string | null;
  accountId: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  creativeId: string | null;
  title: string | null;
  body: string | null;
  objectType: string | null;
  /** Llamada a la acción (p. ej. WHATSAPP_MESSAGE) y enlace del creativo. */
  ctaType: string | null;
  linkUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  /** Video: solo sus datos (el archivo NO se descarga; se ve en Meta). */
  videoId: string | null;
  videoTitle: string | null;
  videoLengthSeconds: number | null;
  videoPictureUrl: string | null;
  storyId: string | null;
  /** Error al leer el video (sin permiso sobre la página, etc.); lo demás sí se obtuvo. */
  videoError: string | null;
  /** Respuestas de la API tal cual (anuncio, creativo, video): la información completa. */
  raw: { ad: Record<string, unknown>; creative?: Record<string, unknown>; video?: Record<string, unknown> };
};

export type MetaApiConfig = {
  token: string;
  version?: string;
  appSecret?: string;
  fetchImpl?: typeof fetch;
};

export function metaApiConfigFromEnv(env: Record<string, string | undefined> = process.env): MetaApiConfig {
  const token = env.META_ADS_ACCESS_TOKEN?.trim();
  if (!token) throw new MetaAdsNotConfiguredError("Falta META_ADS_ACCESS_TOKEN");
  const version = env.META_GRAPH_API_VERSION?.trim();
  return {
    token,
    version: version && /^v\d{1,3}\.\d$/.test(version) ? version : META_GRAPH_VERSION_DEFAULT,
    appSecret: env.META_APP_SECRET?.trim() || undefined,
  };
}

type Json = Record<string, unknown>;

function rec(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

function https(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

const GRAPH_ID = /^\d{1,25}(?:_\d{1,25})?$/;

async function graphGet(config: MetaApiConfig, id: string, params: Record<string, string>): Promise<Json> {
  if (!GRAPH_ID.test(id)) throw new MetaApiError(0, null, `id de Meta inválido: ${JSON.stringify(id.slice(0, 40))}`);
  const search = new URLSearchParams(params);
  // appsecret_proof: solo si la app lo exige ("Requerir secreto de la app").
  if (config.appSecret) search.set("appsecret_proof", createHmac("sha256", config.appSecret).update(config.token).digest("hex"));
  const url = `${GRAPH_HOST}/${config.version ?? META_GRAPH_VERSION_DEFAULT}/${id}?${search.toString()}`;
  let res: Response;
  try {
    res = await (config.fetchImpl ?? fetch)(url, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new MetaApiError(0, null, `Sin respuesta de Meta: ${error instanceof Error ? error.message : String(error)}`);
  }
  const json = rec(await res.json().catch(() => null));
  if (!res.ok || json.error) {
    const err = rec(json.error);
    const code = typeof err.code === "number" ? err.code : null;
    throw new MetaApiError(res.status, code, `Meta ${res.status}${code !== null ? ` (código ${code})` : ""}: ${str(err.message) ?? "sin detalle"}`);
  }
  return json;
}

/** Texto e imagen del creativo cuando no vienen arriba (object_story_spec / asset_feed_spec). */
function creativeFallbacks(creative: Json) {
  const spec = rec(creative.object_story_spec);
  const video = rec(spec.video_data);
  const link = rec(spec.link_data);
  const feed = rec(creative.asset_feed_spec);
  const first = (list: unknown, key: string) => (Array.isArray(list) ? str(rec(list[0])[key]) : null);
  return {
    title: str(video.title) ?? str(link.name) ?? first(feed.titles, "text"),
    body: str(video.message) ?? str(link.message) ?? first(feed.bodies, "text"),
    imageUrl: https(video.image_url) ?? https(link.picture) ?? (Array.isArray(feed.images) ? https(rec(feed.images[0]).url) : null),
    videoId: str(video.video_id) ?? (Array.isArray(feed.videos) ? str(rec(feed.videos[0]).video_id) : null),
    ctaType: str(rec(video.call_to_action).type) ?? str(rec(link.call_to_action).type),
    linkUrl:
      https(rec(rec(video.call_to_action).value).link) ??
      https(rec(rec(link.call_to_action).value).link) ??
      https(link.link),
  };
}

export async function fetchMetaAd(adId: string, config: MetaApiConfig): Promise<MetaAdInfo> {
  const ad = await graphGet(config, adId, {
    fields: "id,name,effective_status,account_id,adset{id,name},campaign{id,name},creative{id}",
  });
  const adset = rec(ad.adset);
  const campaign = rec(ad.campaign);
  const creativeId = str(rec(ad.creative).id);
  const info: MetaAdInfo = {
    adId,
    adName: str(ad.name),
    effectiveStatus: str(ad.effective_status),
    accountId: str(ad.account_id),
    adsetId: str(adset.id),
    adsetName: str(adset.name),
    campaignId: str(campaign.id),
    campaignName: str(campaign.name),
    creativeId,
    title: null,
    body: null,
    objectType: null,
    ctaType: null,
    linkUrl: null,
    imageUrl: null,
    thumbnailUrl: null,
    videoId: null,
    videoTitle: null,
    videoLengthSeconds: null,
    videoPictureUrl: null,
    storyId: null,
    videoError: null,
    raw: { ad },
  };
  if (!creativeId) return info;

  const creative = await graphGet(config, creativeId, {
    fields:
      "id,name,title,body,object_type,call_to_action_type,link_url,image_url,thumbnail_url,video_id," +
      "effective_object_story_id,effective_instagram_media_id,object_story_spec,asset_feed_spec",
    // Miniatura chica pero legible (la de por omisión es de 64×64).
    thumbnail_width: "320",
    thumbnail_height: "320",
  });
  info.raw.creative = creative;
  const fallback = creativeFallbacks(creative);
  info.title = str(creative.title) ?? fallback.title;
  info.body = str(creative.body) ?? fallback.body;
  info.objectType = str(creative.object_type);
  info.ctaType = str(creative.call_to_action_type) ?? fallback.ctaType;
  info.linkUrl = https(creative.link_url) ?? fallback.linkUrl;
  info.imageUrl = https(creative.image_url) ?? fallback.imageUrl;
  info.thumbnailUrl = https(creative.thumbnail_url);
  info.videoId = str(creative.video_id) ?? fallback.videoId;
  info.storyId = str(creative.effective_object_story_id);

  if (info.videoId) {
    // Solo los DATOS del video (título, duración, portada). El video puede ser
    // de la página: sin permiso sobre ella, Meta lo niega; no es fatal.
    try {
      const video = await graphGet(config, info.videoId, { fields: "title,length,picture" });
      info.raw.video = video;
      info.videoTitle = str(video.title);
      info.videoLengthSeconds = typeof video.length === "number" && Number.isFinite(video.length) ? video.length : null;
      info.videoPictureUrl = https(video.picture);
    } catch (error) {
      info.videoError = error instanceof Error ? error.message : String(error);
    }
  }
  return info;
}

/** Enlace al anuncio en el Administrador de anuncios de Meta. */
export function adsManagerUrl(adId: string, accountId: string | null): string {
  const params = new URLSearchParams({ selected_ad_ids: adId });
  if (accountId && /^\d+$/.test(accountId)) params.set("act", accountId);
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?${params.toString()}`;
}

/** Publicación del anuncio (page_post id "página_publicación"). */
export function storyUrl(storyId: string | null): string | null {
  return storyId && GRAPH_ID.test(storyId) ? `https://www.facebook.com/${storyId}` : null;
}

/** Espera antes de volver a consultar un anuncio tras un error. */
export function retryDelayMs(error: unknown, attempts: number): number {
  if (error instanceof MetaAdsNotConfiguredError) return 10 * 60_000;
  if (error instanceof MetaApiError && error.isAuth) return 6 * 3_600_000;
  if (error instanceof MetaApiError && error.isRateLimit) return 3_600_000;
  return Math.min(2 ** Math.max(0, attempts) * 60_000, 6 * 3_600_000);
}
