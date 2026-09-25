// Ficha del anuncio de clic a WhatsApp (CTWA): lectura y normalización PURAS
// (sin base de datos), para testearlas solas.
//
// Lo que confirmó Zernio por escrito (24-sep-2026):
// - message.received trae el `referral` de Meta tal cual cuando el mensaje
//   viene de un clic en un anuncio: en `referral` (raíz del evento) y también
//   en `metadata.referral`;
// - campos con los nombres de Meta: source_id (id del anuncio), source_type,
//   source_url, headline, body, media_type, image_url / video_url /
//   thumbnail_url, ctwa_clid y welcome_message (si Meta los manda);
// - ctwa_clid falta en una minoría de clics (sobre todo desde Estados);
// - el referral viene SOLO en el primer mensaje tras el clic; Zernio guarda
//   el primer clic en la conversación (metadata.ctwa_*);
// - Instagram y Messenger (canales futuros): metadata.referral con ad_id,
//   source "ADS", type "OPEN_THREAD", ref y ads_context_data (ad_title,
//   photo_url o video_url, post_id); sin ctwa_clid.
//
// Regla: una ficha incompleta NUNCA frena el mensaje. Se guarda la original
// completa (raw) y aquí solo se extrae lo que se entiende.

export type AdPlatform = "whatsapp" | "instagram" | "messenger";

export type AdReferralData = {
  platform: AdPlatform;
  /** Id del anuncio en Meta (solo dígitos; si no parece id de anuncio, null). */
  adId: string | null;
  /** "ad", "post", "ADS"… tal como llega. */
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  /** "image" | "video" | … tal como llega. */
  mediaType: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  /** Id del clic (conversiones a Meta). Falta en algunos clics. */
  ctwaClid: string | null;
  /** Mensaje de bienvenida del anuncio, si Meta lo manda. */
  welcomeMessage: string | null;
  /** Instagram/Messenger: publicación del anuncio. */
  postId: string | null;
  /** Instagram/Messenger: parámetro `ref` del enlace. */
  ref: string | null;
};

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  // Algunas integraciones mandan el objeto serializado como texto.
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function nonEmpty(value: Json | undefined): Json | undefined {
  return value && Object.keys(value).length > 0 ? value : undefined;
}

/**
 * Ficha del anuncio de un evento de Zernio, ORIGINAL y completa. Orden: raíz
 * (`referral`) → `metadata.referral` → dentro de `message` (por si una versión
 * del sobre la anida ahí). Devuelve la primera que sea un objeto no vacío.
 */
export function extractReferral(payload: unknown): Json | undefined {
  const root = asRecord(payload) ?? {};
  const message = asRecord(root.message) ?? {};
  const candidates = [
    root.referral,
    asRecord(root.metadata)?.referral,
    message.referral,
    asRecord(message.metadata)?.referral,
  ];
  for (const candidate of candidates) {
    const found = nonEmpty(asRecord(candidate));
    if (found) return found;
  }
  return undefined;
}

const MAX_TEXT = 5_000;
const MAX_URL = 4_000;

function text(raw: Json, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, MAX_TEXT);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Solo https: los links del CDN de Meta lo son; cualquier otra cosa no se descarga ni se muestra. */
export function httpsUrl(value: string | null): string | null {
  if (!value || value.length > MAX_URL) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

// Ids de anuncio de Meta: solo dígitos (p. ej. 120250108412580604). Se exige
// para usarlo en la API de Marketing y en la URL de la página del anuncio.
const AD_ID = /^\d{5,25}$/;

export function validAdId(value: string | null | undefined): string | null {
  return value && AD_ID.test(value) ? value : null;
}

function welcome(raw: Json): string | null {
  const value = raw.welcome_message ?? raw.welcomeMessage;
  if (typeof value === "string") return value.trim().slice(0, MAX_TEXT) || null;
  const record = asRecord(value);
  return record ? text(record, "text", "body") : null;
}

/**
 * Normaliza la ficha (nombres de Meta en snake_case, con tolerancia a
 * camelCase y a la forma de Instagram/Messenger). Nunca lanza.
 */
export function normalizeReferral(raw: Json, platform: AdPlatform = "whatsapp"): AdReferralData {
  const context = asRecord(raw.ads_context_data) ?? asRecord(raw.adsContextData) ?? {};
  const sourceType = text(raw, "source_type", "sourceType", "source");
  // En WhatsApp, source_id es el id del ANUNCIO solo si source_type es "ad"
  // (con "post" es el id de una publicación). Sin tipo, se acepta si es numérico.
  const sourceId = text(raw, "source_id", "sourceId");
  const isPost = sourceType?.toLowerCase() === "post";
  const adId = validAdId(text(raw, "ad_id", "adId") ?? (isPost ? null : sourceId));
  return {
    platform,
    adId,
    sourceType,
    sourceUrl: httpsUrl(text(raw, "source_url", "sourceUrl")),
    headline: text(raw, "headline", "title") ?? text(context, "ad_title", "adTitle"),
    body: text(raw, "body"),
    mediaType: text(raw, "media_type", "mediaType"),
    imageUrl: httpsUrl(text(raw, "image_url", "imageUrl") ?? text(context, "photo_url", "photoUrl")),
    videoUrl: httpsUrl(text(raw, "video_url", "videoUrl") ?? text(context, "video_url", "videoUrl")),
    thumbnailUrl: httpsUrl(text(raw, "thumbnail_url", "thumbnailUrl")),
    ctwaClid: text(raw, "ctwa_clid", "ctwaClid"),
    welcomeMessage: welcome(raw),
    postId: text(context, "post_id", "postId") ?? (isPost ? sourceId : null),
    ref: text(raw, "ref"),
  };
}

/**
 * Link de la ficha para la miniatura del anuncio: la miniatura (anuncios de
 * video) o, si no hay, la imagen (anuncios de imagen; se reduce al guardarla).
 * El video nunca se descarga (decisión del dueño, 25-sep-2026).
 */
export function referralThumbUrl(data: AdReferralData): string | null {
  return data.thumbnailUrl ?? data.imageUrl ?? null;
}

// ─── Respaldo: primer clic guardado por Zernio en la conversación ───────────

export type ConversationClick = {
  /** Ficha reconstruida con los nombres de Meta (para guardarla como raw). */
  referral: Json;
  /** Cuándo capturó Zernio el clic (ctwa_captured_at), si lo trae. */
  capturedAt: Date | null;
};

/**
 * Del GET /v1/inbox/conversations/{id}?accountId=… de Zernio. Verificado en
 * vivo (24-sep-2026): responde { data: { id, accountId, … } } y, para un id
 * que no existe, 200 con datos vacíos (no 404). Zernio documenta el clic en
 * `metadata.ctwa_*`. Sin ctwa_source_id NI ctwa_clid NI ctwa_source_url no hay
 * clic: null.
 */
export function clickFromZernioConversation(response: unknown): ConversationClick | null {
  const root = asRecord(response) ?? {};
  const data = asRecord(root.data) ?? asRecord(root.conversation) ?? root;
  const metadata = asRecord(data.metadata) ?? {};
  const pick = (key: string) => text(metadata, key) ?? text(data, key);
  const sourceId = pick("ctwa_source_id");
  const clid = pick("ctwa_clid");
  const sourceUrl = pick("ctwa_source_url");
  if (!sourceId && !clid && !sourceUrl) return null;
  const referral: Json = {};
  if (sourceId) referral.source_id = sourceId;
  if (sourceUrl) referral.source_url = sourceUrl;
  const headline = pick("ctwa_headline");
  if (headline) referral.headline = headline;
  const sourceType = pick("ctwa_source_type");
  if (sourceType) referral.source_type = sourceType;
  if (clid) referral.ctwa_clid = clid;
  const capturedRaw = pick("ctwa_captured_at");
  const captured = capturedRaw ? new Date(capturedRaw) : null;
  return { referral, capturedAt: captured && !Number.isNaN(captured.getTime()) ? captured : null };
}

/**
 * ¿El clic guardado por Zernio corresponde a ESTE mensaje? Zernio guarda solo
 * el PRIMER clic de la conversación: uno de hace días no es de este mensaje.
 * Se acepta si se capturó entre 24 h antes y 1 h después del mensaje; sin
 * fecha de captura, solo si el mensaje además trae señales de anuncio.
 */
export function conversationClickMatches(click: ConversationClick, messageAt: Date, looksLikeAd: boolean): boolean {
  if (!click.capturedAt) return looksLikeAd;
  const delta = messageAt.getTime() - click.capturedAt.getTime();
  return delta <= 24 * 3_600_000 && delta >= -3_600_000;
}

// Etiquetas de la metadata de Facebook pegadas al texto del cliente (así
// llegaban a GHL: "ctwaClid: …", "sourceType: ad", "sourceId: …").
const AD_LABEL = /^\s*(?:ctwa_?clid|source_?id|source_?type|source_?url|conversion_?source|entry_?point)\s*:/imu;

/**
 * ¿Un entrante SIN ficha parece venir de un anuncio? Señales: etiquetas de
 * anuncio en el texto, o llaves de anuncio en la metadata del proveedor.
 */
export function looksLikeAdMessage(body: string | null, metadata: Record<string, unknown> | undefined | null): boolean {
  if (body && AD_LABEL.test(body)) return true;
  if (!metadata) return false;
  return Object.keys(metadata).some((key) => /^(?:ctwa|referral|ad_?id|source_?id)/i.test(key));
}
