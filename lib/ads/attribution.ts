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

export type FallbackResult = "atribuido" | "sin_datos" | "fuera_de_tiempo" | "ya_registrado" | "mensaje_no_existe" | "error";

/**
 * Registro DURABLE del respaldo en el mensaje (messages.metadata.anuncioRespaldo):
 * nace "pendiente" en la ingesta (misma transacción que el mensaje) con lo
 * necesario para consultar; cada intento anota resultado, hora e intentos. Así,
 * si Redis falla al encolar o Zernio aún no tiene el clic, el barrido lo retoma
 * desde la base (messagesPendingFallback) — nunca depende solo de la cola.
 */
export type FallbackNote = {
  resultado: "pendiente" | FallbackResult;
  cuenta: string;
  conversacion: string;
  pareceAnuncio: boolean;
  intentos: number;
  consultadoEn?: string;
  detalle?: string;
};

export function pendingFallbackNote(job: Omit<FallbackJob, "organizationId" | "messageId">): FallbackNote {
  return {
    resultado: "pendiente",
    cuenta: job.providerAccountId,
    conversacion: job.providerConversationId,
    pareceAnuncio: job.looksLikeAd,
    intentos: 0,
  };
}

/** Reintentos del respaldo: "sin_datos" (Zernio aún no tiene el clic) y "error" (Zernio no respondió). */
export const FALLBACK_MAX_EMPTY = 3;
export const FALLBACK_MAX_ERRORS = 8;

async function noteFallback(organizationId: string, job: FallbackJob, attempts: number, result: FallbackResult, detail?: string) {
  const note: FallbackNote = {
    ...pendingFallbackNote(job),
    resultado: result,
    intentos: attempts,
    consultadoEn: new Date().toISOString(),
    ...(detail ? { detalle: detail.slice(0, 300) } : {}),
  };
  await db
    .update(messages)
    .set({ metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || jsonb_build_object('anuncioRespaldo', ${JSON.stringify(note)}::jsonb)` })
    .where(and(eq(messages.id, job.messageId), eq(messages.organizationId, organizationId)));
}

/**
 * Respaldos por hacer o por reintentar (para el barrido), últimas 24 h:
 * "pendiente" (el job pudo no encolarse), "sin_datos" (<3 intentos, cada 3 min)
 * y "error" (<8 intentos, cada 5 min).
 */
export async function messagesPendingFallback(limit = 50): Promise<FallbackJob[]> {
  const note = sql`${messages.metadata}->'anuncioRespaldo'`;
  const rows = await db
    .select({ id: messages.id, organizationId: messages.organizationId, note: sql<FallbackNote>`${note}` })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "in"),
        gte(messages.createdAt, sql`now() - interval '24 hours'`),
        lte(messages.createdAt, sql`now() - interval '1 minute'`),
        sql`(
          ${note}->>'resultado' = 'pendiente'
          or (${note}->>'resultado' = 'sin_datos' and coalesce((${note}->>'intentos')::int, 0) < ${FALLBACK_MAX_EMPTY}
              and (${note}->>'consultadoEn')::timestamptz < now() - interval '3 minutes')
          or (${note}->>'resultado' = 'error' and coalesce((${note}->>'intentos')::int, 0) < ${FALLBACK_MAX_ERRORS}
              and (${note}->>'consultadoEn')::timestamptz < now() - interval '5 minutes')
        )`,
      ),
    )
    .limit(limit);
  return rows
    .filter((r) => r.note?.cuenta && r.note?.conversacion)
    .map((r) => ({
      organizationId: r.organizationId,
      messageId: r.id,
      providerAccountId: r.note.cuenta,
      providerConversationId: r.note.conversacion,
      looksLikeAd: Boolean(r.note.pareceAnuncio),
    }));
}

/**
 * Mensaje que parece de anuncio y llegó sin ficha: consulta el primer clic que
 * Zernio guardó en la conversación y, si corresponde a este mensaje, lo
 * atribuye. Siempre deja registro (metadata.anuncioRespaldo + log). No lanza:
 * un "sin_datos" o un "error" queda anotado y el barrido lo reintenta con espera.
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
  const [current] = await db
    .select({ note: sql<FallbackNote | null>`${messages.metadata}->'anuncioRespaldo'` })
    .from(messages)
    .where(eq(messages.id, m.id));
  const attempts = Number(current?.note?.intentos ?? 0) + 1;
  const note = (result: FallbackResult, detail?: string) => noteFallback(job.organizationId, job, attempts, result, detail);
  const log = (result: FallbackResult, detail?: string) =>
    console.info(`[anuncios] respaldo por conversación ${job.providerConversationId} (mensaje ${job.messageId}): ${result}${detail ? ` — ${detail}` : ""}`);

  const [already] = await db.select({ id: adClicks.id }).from(adClicks).where(eq(adClicks.messageId, m.id)).limit(1);
  if (already) {
    await note("ya_registrado");
    log("ya_registrado");
    return { result: "ya_registrado", click: null };
  }

  let click;
  try {
    click = provider.conversationAdClick
      ? await provider.conversationAdClick(job.providerAccountId, job.providerConversationId)
      : null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await note("error", detail);
    log("error", `${detail} (intento ${attempts}; el barrido reintenta)`);
    return { result: "error", click: null };
  }
  const messageAt = m.sentAt ?? m.createdAt;
  if (!click) {
    await note("sin_datos");
    log("sin_datos", `Zernio no tiene clic guardado en la conversación (intento ${attempts} de ${FALLBACK_MAX_EMPTY})`);
    return { result: "sin_datos", click: null };
  }
  if (!conversationClickMatches(click, messageAt, job.looksLikeAd)) {
    const detail = `clic capturado ${click.capturedAt?.toISOString() ?? "sin fecha"}, mensaje ${messageAt.toISOString()}`;
    await note("fuera_de_tiempo", detail);
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
      await note("ya_registrado");
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
  await note(result, data.adId ? `anuncio ${data.adId}` : undefined);
  log(result, data.adId ? `anuncio ${data.adId}` : "sin id de anuncio");
  return { result, click: recorded };
}
