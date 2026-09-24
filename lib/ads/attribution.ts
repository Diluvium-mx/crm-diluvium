// Atribución de anuncios: registra cada entrada de un cliente desde un anuncio
// (ad_clicks), ligada al contacto y a la conversación. Dos orígenes:
// - webhook: la ficha (`referral`) vino en el mensaje (lo normal);
// - zernio_conversation: el mensaje llegó SIN ficha pero parecía de anuncio;
//   se usa el primer clic que Zernio guarda en la conversación.
//
// Regla: el anuncio NUNCA frena el mensaje. Dentro de la ingesta se registra en
// un SAVEPOINT (si falla, se revierte solo el anuncio y el mensaje entra igual);
// el barrido del worker vuelve a intentar con la ficha guardada en el mensaje.
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adClicks, conversations, messages, metaAds, type AdMediaItem } from "@/lib/db/schema";
import type { MessagingProvider } from "@/lib/messaging/provider";
import type { Tx } from "@/lib/messaging/ingest";
import { conversationClickMatches, normalizeReferral, referralMediaUrls, type AdPlatform } from "./referral";

export type RecordedClick = { clickId: string; organizationId: string; adId: string | null; hasMedia: boolean };

type ClickInput = {
  organizationId: string;
  contactId: string;
  conversationId: string;
  messageId: string | null;
  origin: "webhook" | "zernio_conversation";
  platform?: AdPlatform;
  raw: Record<string, unknown>;
  clickedAt: Date;
};

/**
 * Inserta el clic (idempotente: un mensaje o un ctwa_clid ya registrado no se
 * duplica → null) y deja el anuncio en la cola de nombres de Meta. NO toca la
 * conversación: quien llama actualiza ad_entry_at con la conversación ya bloqueada.
 */
export async function insertAdClick(tx: Tx, input: ClickInput): Promise<RecordedClick | null> {
  const data = normalizeReferral(input.raw, input.platform ?? "whatsapp");
  const media: AdMediaItem[] = referralMediaUrls(data).map((m) => ({ ...m, attempts: 0 }));
  const id = crypto.randomUUID();
  const inserted = await tx
    .insert(adClicks)
    .values({
      id,
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      origin: input.origin,
      platform: data.platform,
      adId: data.adId,
      sourceType: data.sourceType,
      sourceUrl: data.sourceUrl,
      headline: data.headline,
      body: data.body,
      mediaType: data.mediaType,
      ctwaClid: data.ctwaClid,
      welcomeMessage: data.welcomeMessage,
      raw: input.raw,
      media,
      clickedAt: input.clickedAt,
    })
    // Sin target: cubre ambos índices únicos (mensaje y ctwa_clid).
    .onConflictDoNothing()
    .returning({ id: adClicks.id });
  if (inserted.length === 0) return null;
  if (data.adId) {
    await tx
      .insert(metaAds)
      .values({ organizationId: input.organizationId, adId: data.adId })
      .onConflictDoNothing();
  }
  return { clickId: id, organizationId: input.organizationId, adId: data.adId, hasMedia: media.length > 0 };
}

/**
 * Dentro de la transacción de la ingesta, en un SAVEPOINT: si algo falla, solo
 * se revierte el anuncio (el mensaje se guarda igual) y devuelve "error"; el
 * barrido lo reintenta desde messages.ad_referral.
 */
export async function recordAdClickSafely(tx: Tx, input: ClickInput): Promise<RecordedClick | null | "error"> {
  try {
    return await tx.transaction((sp) => insertAdClick(sp, input));
  } catch (error) {
    console.error(`[anuncios] no se pudo registrar el clic del mensaje ${input.messageId}; el mensaje entra igual y el barrido lo reintenta`, error);
    return "error";
  }
}

/** Fuera de la ingesta: registra el clic y mueve la entrada por anuncio de la conversación. */
async function recordWithConversation(input: ClickInput): Promise<RecordedClick | null> {
  return db.transaction(async (tx) => {
    // Mismo orden de candados que la ingesta: conversación primero.
    const [conversation] = await tx
      .select({ id: conversations.id, adEntryAt: conversations.adEntryAt, adReferral: conversations.adReferral })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)))
      .for("update");
    if (!conversation) return null;
    const click = await insertAdClick(tx, input);
    if (!click) return null;
    await tx
      .update(conversations)
      .set({
        adEntryAt: conversation.adEntryAt && conversation.adEntryAt > input.clickedAt ? conversation.adEntryAt : input.clickedAt,
        // El anuncio que originó la conversación: el primero, no se pisa.
        ...(conversation.adReferral ? {} : { adReferral: input.raw }),
      })
      .where(eq(conversations.id, conversation.id));
    return click;
  });
}

/**
 * Red de seguridad: entrantes con ficha (messages.ad_referral) cuyo clic no
 * quedó registrado (falló el savepoint). Devuelve el clic si se registró ahora.
 */
export async function recordClickFromMessage(organizationId: string, messageId: string): Promise<RecordedClick | null> {
  const [m] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      adReferral: messages.adReferral,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
      contactId: conversations.contactId,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId), eq(messages.direction, "in")))
    .limit(1);
  if (!m?.adReferral || Object.keys(m.adReferral).length === 0) return null;
  return recordWithConversation({
    organizationId,
    contactId: m.contactId,
    conversationId: m.conversationId,
    messageId: m.id,
    origin: "webhook",
    raw: m.adReferral,
    clickedAt: m.sentAt ?? m.createdAt,
  });
}

/** Entrantes con ficha y sin clic registrado (para el barrido). */
export async function messagesWithUnrecordedReferral(limit = 50): Promise<{ id: string; organizationId: string }[]> {
  return db
    .select({ id: messages.id, organizationId: messages.organizationId })
    .from(messages)
    .leftJoin(adClicks, eq(adClicks.messageId, messages.id))
    .where(
      and(
        eq(messages.direction, "in"),
        sql`${messages.adReferral} is not null and ${messages.adReferral} <> '{}'::jsonb`,
        isNull(adClicks.id),
        // El mismo clic (ctwa_clid) ya registrado en otro mensaje no se reintenta
        // (sin esto, el barrido lo re-encolaría cada minuto sin registrarlo nunca).
        sql`not exists (select 1 from ${adClicks} dup
                         where dup.organization_id = ${messages.organizationId}
                           and dup.ctwa_clid = coalesce(${messages.adReferral}->>'ctwa_clid', ${messages.adReferral}->>'ctwaClid'))`,
        gte(messages.createdAt, sql`now() - interval '7 days'`),
        lte(messages.createdAt, sql`now() - interval '1 minute'`),
      ),
    )
    .limit(limit);
}

// ─── Respaldo con la conversación de Zernio ─────────────────────────────────

export type FallbackJob = {
  organizationId: string;
  messageId: string;
  providerAccountId: string;
  providerConversationId: string;
  /** El mensaje traía señales de anuncio (etiquetas o llaves en la metadata). */
  looksLikeAd: boolean;
};

export type FallbackResult = "atribuido" | "sin_datos" | "fuera_de_tiempo" | "ya_registrado" | "mensaje_no_existe";

/** Deja el resultado del respaldo en el mensaje (registro visible y consultable). */
async function noteFallback(organizationId: string, messageId: string, result: FallbackResult | "error", detail?: string) {
  const note = { resultado: result, consultadoEn: new Date().toISOString(), ...(detail ? { detalle: detail.slice(0, 300) } : {}) };
  await db
    .update(messages)
    .set({ metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || jsonb_build_object('anuncioRespaldo', ${JSON.stringify(note)}::jsonb)` })
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)));
}

/**
 * Mensaje que parece de anuncio y llegó sin ficha: consulta el primer clic que
 * Zernio guardó en la conversación y, si corresponde a este mensaje, lo
 * atribuye. Siempre deja registro (metadata.anuncioRespaldo + log). Lanza solo
 * si Zernio no respondió (el job se reintenta).
 */
export async function attributeFromProviderConversation(
  provider: Pick<MessagingProvider, "conversationAdClick">,
  job: FallbackJob,
): Promise<{ result: FallbackResult; click: RecordedClick | null }> {
  const [m] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
      contactId: conversations.contactId,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, job.messageId), eq(messages.organizationId, job.organizationId)))
    .limit(1);
  if (!m) return { result: "mensaje_no_existe", click: null };
  const log = (result: FallbackResult, detail?: string) =>
    console.info(`[anuncios] respaldo por conversación ${job.providerConversationId} (mensaje ${job.messageId}): ${result}${detail ? ` — ${detail}` : ""}`);

  const [already] = await db.select({ id: adClicks.id }).from(adClicks).where(eq(adClicks.messageId, m.id)).limit(1);
  if (already) {
    await noteFallback(job.organizationId, m.id, "ya_registrado");
    log("ya_registrado");
    return { result: "ya_registrado", click: null };
  }

  let click;
  try {
    click = await provider.conversationAdClick(job.providerAccountId, job.providerConversationId);
  } catch (error) {
    await noteFallback(job.organizationId, m.id, "error", error instanceof Error ? error.message : String(error)).catch(() => undefined);
    throw error;
  }
  const messageAt = m.sentAt ?? m.createdAt;
  if (!click) {
    await noteFallback(job.organizationId, m.id, "sin_datos");
    log("sin_datos", "Zernio no tiene clic guardado en la conversación");
    return { result: "sin_datos", click: null };
  }
  if (!conversationClickMatches(click, messageAt, job.looksLikeAd)) {
    const detail = `clic capturado ${click.capturedAt?.toISOString() ?? "sin fecha"}, mensaje ${messageAt.toISOString()}`;
    await noteFallback(job.organizationId, m.id, "fuera_de_tiempo", detail);
    log("fuera_de_tiempo", detail);
    return { result: "fuera_de_tiempo", click: null };
  }
  // Sin ctwa_clid, el mismo clic ya registrado en esta conversación (mismo
  // anuncio, ±24 h) tampoco se duplica.
  const data = normalizeReferral(click.referral);
  if (!data.ctwaClid) {
    const around = click.capturedAt ?? messageAt;
    const [dup] = await db
      .select({ id: adClicks.id })
      .from(adClicks)
      .where(
        and(
          eq(adClicks.organizationId, job.organizationId),
          eq(adClicks.conversationId, m.conversationId),
          data.adId ? eq(adClicks.adId, data.adId) : isNull(adClicks.adId),
          gte(adClicks.clickedAt, new Date(around.getTime() - 24 * 3_600_000)),
          lte(adClicks.clickedAt, new Date(around.getTime() + 24 * 3_600_000)),
        ),
      )
      .orderBy(desc(adClicks.clickedAt))
      .limit(1);
    if (dup) {
      await noteFallback(job.organizationId, m.id, "ya_registrado");
      log("ya_registrado", "mismo anuncio ya registrado en la conversación");
      return { result: "ya_registrado", click: null };
    }
  }
  const recorded = await recordWithConversation({
    organizationId: job.organizationId,
    contactId: m.contactId,
    conversationId: m.conversationId,
    messageId: m.id,
    origin: "zernio_conversation",
    raw: { ...click.referral, ...(click.capturedAt ? { ctwa_captured_at: click.capturedAt.toISOString() } : {}) },
    clickedAt: messageAt,
  });
  const result: FallbackResult = recorded ? "atribuido" : "ya_registrado";
  await noteFallback(job.organizationId, m.id, result, data.adId ? `anuncio ${data.adId}` : undefined);
  log(result, data.adId ? `anuncio ${data.adId}` : "sin id de anuncio");
  return { result, click: recorded };
}
