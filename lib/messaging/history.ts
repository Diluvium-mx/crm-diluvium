// Historial del celular (coexistencia; docs/numero-prueba.md, paso 5). Al conectar un
// número de la app de WhatsApp Business, Meta copia hasta 6 meses de chats y Zernio
// los guarda marcados `coexistence_history`. Llegan por dos caminos que terminan aquí:
// el importador (scripts/importar-historial.ts, lee la API de Zernio) y, si Zernio los
// mandara también por webhook, la ingesta (ingest.ts los desvía por `event.history`).
//
// Un mensaje del historial es REGISTRO, no conversación viva:
// - NUNCA dispara agente, workflows ni palabras clave (no llama a los ganchos);
// - no suma no leídos, no abre ni alarga la ventana de 24 h, no cambia el estado de
//   la conversación, no mueve etapa ni temperatura;
// - no cuenta como primera respuesta, ni en el semáforo, ni en el Dashboard
//   (`messages.imported_at` los excluye);
// - se guarda con su fecha, dirección, tipo y adjuntos originales, sin duplicados
//   (wamid único) y con la marca "Importado del celular" (imported_at).
// Los contactos que crea nacen en Inbox, con source `historial_celular` (el Dashboard
// no los cuenta como conversaciones nuevas) y marcados Prueba si el canal es de prueba.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactsImportLockKey } from "@/lib/db/locks";
import { withTxRetry } from "@/lib/db/retry";
import { channels, contacts, conversations, messages, type MessageAttachment } from "@/lib/db/schema";
import { MEDIA_MAX_ATTEMPTS } from "./media-keys";
import { canonicalPhone, phoneLookupVariants } from "@/lib/phone";
import {
  AmbiguousContactError,
  DeadLetterIngestError,
  eventIdentity,
  resolveContact,
  type IngestHooks,
  type Tx,
} from "./ingest";
import type { NormalizedMessageEvent, ProviderName } from "./provider";
import { windowExpiresAt } from "./rules";

export { AmbiguousContactError };

/**
 * ¿Es copia del historial del celular? Sí si trae la marca, o si su hora de WhatsApp
 * es ANTERIOR a la conexión del número a la API (channels.connected_at): nada de lo
 * enviado antes de conectar puede ser un mensaje vivo, aunque Zernio lo mande por
 * webhook sin la marca `coexistence_history`.
 */
export function isPhoneHistory(channel: Pick<ChannelRow, "connectedAt">, event: Pick<NormalizedMessageEvent, "history" | "sentAt">): boolean {
  return event.history === true || (channel.connectedAt !== null && event.sentAt.getTime() < channel.connectedAt.getTime());
}

/**
 * Meta solo copia la media de las últimas ~2 semanas. Un adjunto más viejo queda
 * "no disponible" con su tipo y nombre (sin descarga: no gasta peticiones de Zernio);
 * los recientes quedan pendientes y el barrido del worker los baja poco a poco.
 */
export const HISTORY_MEDIA_MAX_AGE_DAYS = 14;
export const OLD_HISTORY_MEDIA_REASON = "Adjunto del historial con más de 2 semanas: Meta ya no lo guarda";

/** Adjuntos del historial listos para guardar (sin URL o viejos = "no disponible"). */
export function storedAttachments(event: Pick<NormalizedMessageEvent, "attachments" | "sentAt">, now = new Date()): MessageAttachment[] {
  const old = now.getTime() - event.sentAt.getTime() > HISTORY_MEDIA_MAX_AGE_DAYS * 86_400_000;
  return event.attachments.map((a) => {
    const { unavailable, ...rest } = a;
    const reason = unavailable ?? (old ? OLD_HISTORY_MEDIA_REASON : undefined);
    return reason ? { ...rest, downloadAttempts: MEDIA_MAX_ATTEMPTS, downloadError: reason } : rest;
  });
}

/** source de los contactos que nacen del historial (el Dashboard los excluye). */
export const HISTORY_CONTACT_SOURCE = "historial_celular";
/** Igual, para los que nacen del historial de Instagram (docs/instagram.md). */
export const INSTAGRAM_HISTORY_CONTACT_SOURCE = "historial_instagram";

type ChannelRow = typeof channels.$inferSelect;

export type HistoryOutcome = "importado" | "duplicado";

/** Chat del historial: su conversación en el proveedor y la identidad del cliente. */
export type HistoryChat = {
  providerConversationId: string;
  phone: string | null;
  bsuid: string | null;
  name?: string;
  /**
   * Instagram (docs/instagram.md): el cliente se identifica por su id de Instagram (nunca hay
   * teléfono) y la ventana sí se calcula con su último mensaje: en Instagram es un hecho de
   * Meta y sin ella un vendedor no podría contestar un chat reciente (24 h / 7 días).
   */
  instagramId?: string | null;
  username?: string | null;
};

/** A quién se pegó el chat: contacto de GHL, otro existente, uno nuevo, o la conversación ya existía. */
export type HistoryContactMatch = "existente_ghl" | "existente" | "nuevo" | "conversacion_existente";

export type HistoryWriteResult = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  contact: HistoryContactMatch;
  /** ids de los mensajes nuevos (los repetidos por wamid no entran). */
  inserted: string[];
  duplicates: number;
};

/**
 * Contactos candidatos por teléfono (todas sus formas) o BSUID, con los MISMOS
 * candados y en el mismo orden que resolveContact (importación CSV compartida →
 * identidad): entre contarlos y crear/usar el contacto nadie puede meter otro.
 */
async function lockedCandidates(tx: Tx, orgId: string, phone: string | null, bsuid: string | null) {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${contactsImportLockKey(orgId)}, 0))`);
  const keys = [phone && `contact:${orgId}:phone:${phone}`, bsuid && `contact:${orgId}:bsuid:${bsuid}`]
    .filter((k): k is string => Boolean(k))
    .sort();
  for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  const match = [phone ? inArray(contacts.phoneE164, phoneLookupVariants(phone)) : undefined, bsuid ? eq(contacts.waBsuid, bsuid) : undefined].filter(
    (c) => c !== undefined,
  );
  if (match.length === 0) return [];
  return tx
    .select({ id: contacts.id, source: contacts.source, ghlContactId: contacts.ghlContactId })
    .from(contacts)
    .where(and(eq(contacts.organizationId, orgId), or(...match)))
    .orderBy(asc(contacts.createdAt), asc(contacts.id));
}

/**
 * Escribe mensajes del historial de UN chat en una sola transacción (un INSERT para
 * todos). Solo toca el orden de la lista (last_message_at): NADA de no leídos,
 * ventana, estado, primera respuesta, anuncio, etapa ni temperatura.
 * `batchNotify`: la transacción apaga el aviso de tiempo real por fila (migración
 * 0039); quien llama manda UN aviso `inbox.bulk` por lote.
 */
async function writeHistory(
  tx: Tx,
  channel: ChannelRow,
  chat: HistoryChat,
  events: readonly NormalizedMessageEvent[],
  opts: { now: Date; batchNotify: boolean },
): Promise<HistoryWriteResult> {
  const orgId = channel.organizationId;
  if (opts.batchNotify) await tx.execute(sql`select set_config('crm.avisos_en_lote', 'on', true)`);

  let conversation = chat.providerConversationId
    ? (
        await tx
          .select()
          .from(conversations)
          .where(and(eq(conversations.channelId, channel.id), eq(conversations.providerConversationId, chat.providerConversationId)))
          .limit(1)
      )[0]
    : undefined;
  let contact: HistoryContactMatch = "conversacion_existente";

  if (!conversation && chat.instagramId) {
    // Instagram: un cliente = un contacto por su id (único); sin ambigüedades de teléfono.
    const [existing] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.organizationId, orgId), eq(contacts.instagramId, chat.instagramId)))
      .limit(1);
    const contactId = await resolveContact(
      tx,
      orgId,
      { phone: null, bsuid: null, instagramId: chat.instagramId, username: chat.username, name: chat.name },
      undefined,
      { source: INSTAGRAM_HISTORY_CONTACT_SOURCE, esPrueba: channel.isTest },
    );
    contact = existing ? "existente" : "nuevo";
    [conversation] = await tx
      .insert(conversations)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        contactId,
        channelId: channel.id,
        providerConversationId: chat.providerConversationId || null,
        lastMessageAt: events[0]?.sentAt ?? opts.now,
      })
      .onConflictDoUpdate({
        target: [conversations.channelId, conversations.contactId],
        set: {
          providerConversationId: sql`coalesce(${conversations.providerConversationId}, excluded.provider_conversation_id)`,
        },
      })
      .returning();
  }

  if (!conversation) {
    const { phone, bsuid } = chat;
    if (!phone && !bsuid) {
      throw new DeadLetterIngestError(`historial sin teléfono, BSUID ni conversación conocida (conversación ${chat.providerConversationId})`);
    }
    const candidates = await lockedCandidates(tx, orgId, phone, bsuid);
    if (candidates.length > 1) throw new AmbiguousContactError(phone ?? bsuid ?? "", candidates.map((c) => c.id));
    const contactId = await resolveContact(tx, orgId, { phone, bsuid, name: chat.name }, undefined, {
      source: HISTORY_CONTACT_SOURCE,
      esPrueba: channel.isTest,
    });
    const existing = candidates[0];
    contact = !existing ? "nuevo" : existing.source === "ghl_import" || existing.ghlContactId ? "existente_ghl" : "existente";
    [conversation] = await tx
      .insert(conversations)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        contactId,
        channelId: channel.id,
        providerConversationId: chat.providerConversationId || null,
        lastMessageAt: events[0]?.sentAt ?? opts.now,
      })
      .onConflictDoUpdate({
        target: [conversations.channelId, conversations.contactId],
        set: {
          providerConversationId: sql`coalesce(${conversations.providerConversationId}, excluded.provider_conversation_id)`,
        },
      })
      .returning();
  }

  // Mismo orden de bloqueo que la ingesta en vivo: conversación → mensajes.
  const [locked] = await tx.select().from(conversations).where(eq(conversations.id, conversation.id)).for("update");
  if (events.length === 0) {
    return { organizationId: orgId, conversationId: locked.id, contactId: locked.contactId, contact, inserted: [], duplicates: 0 };
  }

  const rows = await tx
    .insert(messages)
    .values(
      events.map((event) => {
        const attachments = storedAttachments(event, opts.now);
        const first = attachments[0];
        return {
          id: crypto.randomUUID(),
          organizationId: orgId,
          conversationId: locked.id,
          direction: event.direction,
          source: event.source,
          type: event.type,
          body: event.body,
          attachments,
          mediaUrl: first?.url || null,
          mediaMimeType: first?.mimeType ?? null,
          providerMessageId: event.providerMessageId,
          // La API de Zernio no da su id interno en el historial (solo el wamid).
          providerInternalId: event.providerInternalId || null,
          metadata: event.metadata ?? null,
          status: event.direction === "in" ? ("received" as const) : ("sent" as const),
          sentAt: event.sentAt,
          importedAt: opts.now,
        };
      }),
    )
    // Cualquier choque de unicidad (wamid, o id interno) = ya estaba: no se duplica.
    .onConflictDoNothing()
    .returning({ id: messages.id, sentAt: messages.sentAt });

  // Solo el orden de la lista (último mensaje).
  const newest = rows.reduce<Date | null>((max, r) => (r.sentAt && (!max || r.sentAt > max) ? r.sentAt : max), null);
  const updates: Partial<typeof conversations.$inferInsert> = {};
  if (newest && (!locked.lastMessageAt || locked.lastMessageAt < newest)) updates.lastMessageAt = newest;
  // Instagram: la ventana de Meta (24 h desde el último mensaje del cliente) aunque el CRM
  // no lo haya visto en vivo. Solo se alarga; sin no leídos, agente ni workflows.
  if (chat.instagramId) {
    const lastInbound = events.reduce<Date | null>((max, e) => (e.direction === "in" && (!max || e.sentAt > max) ? e.sentAt : max), null);
    if (lastInbound) {
      const window = windowExpiresAt(lastInbound, locked.windowExpiresAt);
      if (!locked.windowExpiresAt || window > locked.windowExpiresAt) updates.windowExpiresAt = window;
    }
  }
  if (Object.keys(updates).length > 0) await tx.update(conversations).set(updates).where(eq(conversations.id, locked.id));
  return {
    organizationId: orgId,
    conversationId: locked.id,
    contactId: locked.contactId,
    contact,
    inserted: rows.map((r) => r.id),
    duplicates: events.length - rows.length,
  };
}

/**
 * Una página de mensajes del historial de UN chat (importador). Todo o nada: si
 * falla, se reintenta la página completa y el wamid único evita duplicados.
 */
export async function ingestHistoryPage(
  channel: ChannelRow,
  chat: HistoryChat,
  events: readonly NormalizedMessageEvent[],
  opts: { now?: Date; batchNotify?: boolean } = {},
): Promise<HistoryWriteResult> {
  const now = opts.now ?? new Date();
  return withTxRetry(() => db.transaction((tx) => writeHistory(tx, channel, chat, events, { now, batchNotify: opts.batchNotify ?? false })));
}

/** Un mensaje del historial que llegó por webhook (un aviso de tiempo real por fila, como siempre). */
export async function ingestHistoryMessage(
  provider: ProviderName,
  channel: ChannelRow,
  event: NormalizedMessageEvent,
  hooks: Pick<IngestHooks, "onMediaMessage"> = {},
): Promise<{ outcome: string; organizationId: string; result: HistoryOutcome }> {
  if (channel.provider !== provider) throw new Error(`canal ${channel.id} no es de ${provider}`);
  const { phone, bsuid } = eventIdentity(event);
  const now = new Date();
  const result = await ingestHistoryPage(
    channel,
    { providerConversationId: event.providerConversationId, phone, bsuid, name: event.contactName },
    [event],
    { now },
  );
  const inserted = result.inserted[0];
  // Después del commit: la descarga ya puede leer la fila (si no hay cola, el
  // barrido del worker recoge los adjuntos pendientes).
  if (inserted && storedAttachments(event, now).some((a) => a.url && !a.downloadError) && hooks.onMediaMessage) await hooks.onMediaMessage(inserted);
  return inserted
    ? { outcome: "historial del celular importado", organizationId: result.organizationId, result: "importado" }
    : { outcome: "historial del celular duplicado (wamid ya guardado)", organizationId: result.organizationId, result: "duplicado" };
}

/** Nombre de relleno que la ingesta pone cuando WhatsApp no trae nombre. */
const PLACEHOLDER_NAMES = new Set(["cliente de whatsapp", ""]);

/** ¿El nombre del contacto está "vacío" (placeholder o el propio teléfono)? */
export function isEmptyContactName(firstName: string, lastName: string | null, phoneE164: string | null): boolean {
  if (lastName && lastName.trim()) return false;
  const name = firstName.trim();
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return true;
  const digits = name.replace(/\D/g, "");
  // El teléfono como nombre (con o sin +, espacios o el 1 heredado de México).
  if (!phoneE164 || digits.length < 8 || digits.length !== name.replace(/[\s()+\-.]/g, "").length) return false;
  const phoneDigits = phoneE164.replace(/\D/g, "");
  return digits === phoneDigits || phoneLookupVariants(phoneE164).some((v) => v.replace(/\D/g, "") === digits) || phoneDigits.endsWith(digits);
}

/**
 * Agenda del celular (contactos que Zernio importó de la app): SOLO rellena el
 * nombre de contactos que YA existen y lo tienen vacío. Nunca crea contactos (se
 * crean únicamente si tienen chat en el historial) ni pisa un nombre real.
 */
export async function fillEmptyContactNames(
  organizationId: string,
  entries: ReadonlyArray<{ phoneE164: string; name: string }>,
): Promise<{ filled: number; skipped: number }> {
  let filled = 0;
  let skipped = 0;
  const valid: { phoneE164: string; name: string }[] = [];
  for (const entry of entries) {
    const name = entry.name.trim().slice(0, 200);
    if (!name || /^\+?[\d\s()\-.]+$/.test(name)) skipped++;
    else valid.push({ phoneE164: canonicalPhone(entry.phoneE164), name });
  }
  // Por tandas (una lectura por cada 500 teléfonos): 1,000+ contactos de la agenda
  // no son 1,000+ viajes a la base por el proxy.
  for (let i = 0; i < valid.length; i += 500) {
    const chunk = valid.slice(i, i + 500);
    const matches = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, phoneE164: contacts.phoneE164 })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.phoneE164, chunk.flatMap((e) => phoneLookupVariants(e.phoneE164)))));
    const byPhone = new Map<string, typeof matches>();
    for (const c of matches) {
      if (!c.phoneE164) continue;
      const key = canonicalPhone(c.phoneE164);
      byPhone.set(key, [...(byPhone.get(key) ?? []), c]);
    }
    for (const entry of chunk) {
      let touched = false;
      for (const c of byPhone.get(entry.phoneE164) ?? []) {
        if (!isEmptyContactName(c.firstName, c.lastName, c.phoneE164)) continue;
        // Condición repetida en el UPDATE: si alguien le puso nombre mientras tanto, no se pisa.
        const updated = await db
          .update(contacts)
          .set({ firstName: entry.name })
          .where(and(eq(contacts.id, c.id), eq(contacts.organizationId, organizationId), eq(contacts.firstName, c.firstName)))
          .returning({ id: contacts.id });
        if (updated.length > 0) {
          touched = true;
          c.firstName = entry.name; // un teléfono repetido en la agenda no lo vuelve a tocar
        }
      }
      if (touched) filled++;
      else skipped++;
    }
  }
  return { filled, skipped };
}
