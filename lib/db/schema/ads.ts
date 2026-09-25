// Anuncios de Meta (clic a WhatsApp) — atribución y caché de nombres.
//
// - `ad_clicks`: UN registro por cada entrada de un cliente desde un anuncio.
//   Meta manda la ficha (`referral`) solo en el PRIMER mensaje tras el clic;
//   por eso la atribución vive aquí, ligada al CONTACTO y a la CONVERSACIÓN (no
//   solo al mensaje). Un cliente que vuelve por otro anuncio deja otro registro.
//   `raw` guarda la ficha ORIGINAL completa, sin recortar; las columnas son lo
//   que se entiende. Sin archivos por clic (decisión del dueño, 25-sep-2026).
// - `meta_ads`: por anuncio, lo que devuelve la API de Marketing de Meta
//   (campaña, conjunto, anuncio, creativo, video) y UNA miniatura chica en el
//   bucket. Si Meta falla, la UI muestra lo que haya (la ficha del clic) y el
//   worker reintenta. El video del anuncio NO se guarda: se ve en Meta.
import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { contacts } from "./contacts";
import { conversations, messages } from "./messaging";

export const adClicks = pgTable(
  "ad_clicks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Mensaje que trajo la ficha (o al que se atribuyó el respaldo).
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    // webhook = la ficha vino en el mensaje; zernio_conversation = respaldo con
    // el primer clic que Zernio guarda en la conversación.
    origin: text("origin").notNull(),
    platform: text("platform").notNull().default("whatsapp"),
    // Id del anuncio en Meta (source_id). Null si la ficha vino sin él.
    adId: text("ad_id"),
    sourceType: text("source_type"),
    sourceUrl: text("source_url"),
    headline: text("headline"),
    body: text("body"),
    mediaType: text("media_type"),
    ctwaClid: text("ctwa_clid"),
    welcomeMessage: text("welcome_message"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    // Hora del mensaje del clic según WhatsApp.
    clickedAt: timestamp("clicked_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Un mensaje trae a lo más UNA ficha: un reintento del proveedor no duplica.
    uniqueIndex("ad_clicks_message_uidx").on(table.messageId).where(sql`${table.messageId} is not null`),
    // El mismo clic (ctwa_clid) no se registra dos veces (webhook + respaldo).
    uniqueIndex("ad_clicks_org_clid_uidx")
      .on(table.organizationId, table.ctwaClid)
      .where(sql`${table.ctwaClid} is not null`),
    index("ad_clicks_org_ad_idx").on(table.organizationId, table.adId, table.clickedAt),
    index("ad_clicks_contact_idx").on(table.contactId, table.clickedAt),
    index("ad_clicks_conversation_idx").on(table.conversationId, table.clickedAt),
  ],
);

export const metaAds = pgTable(
  "meta_ads",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    adId: text("ad_id").notNull(),
    adName: text("ad_name"),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    accountId: text("account_id"),
    effectiveStatus: text("effective_status"),
    creativeId: text("creative_id"),
    creativeTitle: text("creative_title"),
    creativeBody: text("creative_body"),
    creativeObjectType: text("creative_object_type"),
    // Llamada a la acción (p. ej. WHATSAPP_MESSAGE) y enlace del creativo.
    ctaType: text("cta_type"),
    linkUrl: text("link_url"),
    // Video del anuncio: solo sus datos (el archivo se ve en Meta).
    videoId: text("video_id"),
    videoTitle: text("video_title"),
    videoLengthSeconds: doublePrecision("video_length_seconds"),
    // Publicación del anuncio (page_post): https://www.facebook.com/{story_id}.
    storyId: text("story_id"),
    // Enlaces "Ver en Meta" (Administrador de anuncios) y "Ver publicación".
    adsManagerUrl: text("ads_manager_url"),
    postUrl: text("post_url"),
    // Respuestas de la API tal cual (anuncio, creativo y video): la info completa.
    metaRaw: jsonb("meta_raw").$type<Record<string, unknown>>(),
    // UNA miniatura chica (JPEG ≤ 320 px) por anuncio en el bucket propio.
    // thumbnail_url = link de origen vigente (de Meta; caduca y se renueva al refrescar).
    thumbnailKey: text("thumbnail_key"),
    thumbnailUrl: text("thumbnail_url"),
    thumbnailAttempts: integer("thumbnail_attempts").notNull().default(0),
    thumbnailError: text("thumbnail_error"),
    thumbnailStoredAt: timestamp("thumbnail_stored_at"),
    fetchedAt: timestamp("fetched_at"),
    fetchError: text("fetch_error"),
    fetchAttempts: integer("fetch_attempts").notNull().default(0),
    nextFetchAt: timestamp("next_fetch_at"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.adId] }),
    index("meta_ads_next_fetch_idx").on(table.nextFetchAt),
  ],
);
