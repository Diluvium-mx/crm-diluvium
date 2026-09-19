// Lecturas y escrituras de la bandeja con la organización EXPLÍCITA (la
// resuelve actions.ts desde la sesión; nunca viene del cliente). Toda consulta
// filtra por organization_id (CLAUDE.md §7).
//
// Las horas que viajan en cursores se comparan en SQL (con microsegundos), no
// ida y vuelta por JS, que solo tiene milisegundos.
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, conversations, messages } from "@/lib/db/schema";
import { latestInboundMessageId, unreadAfterCutoff } from "@/lib/messaging/ingest";
import { attachmentView, avatarInitials, canRetry, fullName, messagePreview, sanitizeReferral } from "./format";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationPage,
  InboxContact,
  InboxFilter,
  MessageKind,
  MessagePage,
  MessageView,
} from "./types";

const PAGE_SIZE = 50;
const MAX_MESSAGES_PAGE = 100;

// Orden de la lista: último mensaje arriba (docs/bandeja.md: no hay "Reciente").
const conversationSortKey = sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;
// Orden del hilo: hora de WhatsApp; si faltara, cuándo se guardó.
const messageSortKey = sql`coalesce(${messages.sentAt}, ${messages.createdAt})`;

// Respuesta humana que SÍ salió (misma regla que la primera respuesta, ingest.ts).
const humanReplySent = sql`${messages.direction} = 'out'
  and ${messages.status} in ('sent', 'delivered', 'read')
  and (${messages.source} = 'business_app' or (${messages.source} = 'crm' and ${messages.sentByUserId} is not null))`;

function toContact(row: typeof contacts.$inferSelect): InboxContact {
  return {
    id: row.id,
    name: fullName(row.firstName, row.lastName),
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phoneE164,
    avatarInitials: avatarInitials(row.firstName, row.lastName),
    sourceChannel: row.sourceChannel,
  };
}

function encodeCursor(sortKey: string, id: string): string {
  return Buffer.from(JSON.stringify([sortKey, id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string")) {
      // La hora viene de un ::text de Postgres; se valida antes de usarla.
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value[0])) return null;
      return [value[0], value[1]];
    }
  } catch {
    // cursor corrupto → primera página
  }
  return null;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function searchCondition(search: string | undefined): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  const byName = ilike(sql`${contacts.firstName} || ' ' || coalesce(${contacts.lastName}, '')`, `%${escapeLike(term)}%`);
  const digits = term.replace(/\D/g, "");
  if (digits.length < 3) return byName;
  return or(byName, sql`regexp_replace(coalesce(${contacts.phoneE164}, ''), '\\D', '', 'g') like ${`%${digits}%`}`);
}

export async function listConversationsForOrg(
  organizationId: string,
  { filter = "all", search, cursor }: { filter?: InboxFilter; search?: string; cursor?: string | null } = {},
): Promise<ConversationPage> {
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await db
    .select({ conversation: conversations, contact: contacts, sortKey: sql<string>`${conversationSortKey}::text` })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.organizationId, organizationId)))
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        filter === "unread" ? sql`${conversations.unreadCount} > 0` : undefined,
        filter === "starred" ? eq(conversations.isStarred, true) : undefined,
        searchCondition(search),
        after ? sql`(${conversationSortKey}, ${conversations.id}) < (${after[0]}::timestamp, ${after[1]})` : undefined,
      ),
    )
    .orderBy(desc(conversationSortKey), desc(conversations.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((r) => r.conversation.id);
  const [lastMessages, awaiting] = ids.length
    ? await Promise.all([lastMessageOf(organizationId, ids), awaitingReplySince(organizationId, ids)])
    : [new Map(), new Map()];

  const items: ConversationListItem[] = page.map(({ conversation, contact }) => {
    const last = lastMessages.get(conversation.id);
    return {
      id: conversation.id,
      contact: toContact(contact),
      lastMessage: last
        ? {
            preview: messagePreview(last.type as MessageKind, last.body),
            direction: last.direction,
            kind: last.type as MessageKind,
            at: last.at,
          }
        : null,
      unreadCount: conversation.unreadCount,
      isStarred: conversation.isStarred,
      awaitingReplySince: awaiting.get(conversation.id) ?? null,
      // Se manda la ventana tal cual; la UI decide "quedan X h" o si venció.
      windowExpiresAt: conversation.windowExpiresAt,
    };
  });
  const lastRow = page.at(-1);
  return {
    items,
    nextCursor: rows.length > PAGE_SIZE && lastRow ? encodeCursor(lastRow.sortKey, lastRow.conversation.id) : null,
  };
}

async function lastMessageOf(organizationId: string, conversationIds: string[]) {
  const rows = await db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      direction: messages.direction,
      type: messages.type,
      body: messages.body,
      at: sql<Date>`${messageSortKey}`.mapWith(messages.sentAt),
    })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), inArray(messages.conversationId, conversationIds)))
    .orderBy(messages.conversationId, desc(messageSortKey), desc(messages.id));
  return new Map(rows.map((r) => [r.conversationId, r]));
}

/**
 * Semáforo: el entrante más viejo posterior a la última respuesta humana que
 * salió. Si el vendedor ya contestó después del último mensaje del cliente,
 * no hay nada pendiente.
 */
async function awaitingReplySince(organizationId: string, conversationIds: string[]) {
  const lastReply = db
    .select({ at: sql`max(${messages.sentAt})` })
    .from(messages)
    .where(and(sql`${messages.conversationId} = pending.conversation_id`, humanReplySent));
  const rows = await db
    .select({
      conversationId: sql<string>`pending.conversation_id`,
      since: sql<Date>`min(pending.sent_at)`.mapWith(messages.sentAt),
    })
    .from(sql`${messages} as pending`)
    .where(
      and(
        sql`pending.organization_id = ${organizationId}`,
        sql`pending.conversation_id in ${conversationIds}`,
        sql`pending.direction = 'in'`,
        sql`pending.sent_at > coalesce((${lastReply}), '-infinity'::timestamp)`,
      ),
    )
    .groupBy(sql`pending.conversation_id`);
  return new Map(rows.map((r) => [r.conversationId, r.since]));
}

async function detail(where: SQL): Promise<ConversationDetail | null> {
  const [row] = await db
    .select({ conversation: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(where)
    .orderBy(desc(conversationSortKey))
    .limit(1);
  if (!row) return null;
  const { conversation, contact } = row;
  return {
    id: conversation.id,
    contact: { ...toContact(contact), stage: contact.stage, temperature: contact.temperature },
    windowExpiresAt: conversation.windowExpiresAt,
    isStarred: conversation.isStarred,
    unreadCount: conversation.unreadCount,
    adReferral: sanitizeReferral(conversation.adReferral),
  };
}

export function getConversationForOrg(organizationId: string, conversationId: string) {
  return detail(and(eq(conversations.organizationId, organizationId), eq(conversations.id, conversationId))!);
}

/** Tarjeta del kanban → chat. Si el contacto tiene chat en varios canales, el más reciente. */
export function getConversationByContactForOrg(organizationId: string, contactId: string) {
  return detail(and(eq(conversations.organizationId, organizationId), eq(conversations.contactId, contactId))!);
}

export async function listMessagesForOrg(
  organizationId: string,
  conversationId: string,
  { before, limit = 50 }: { before?: string | null; limit?: number } = {},
  now = new Date(),
): Promise<MessagePage | null> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conversation) return null;

  const size = Math.min(Math.max(Math.trunc(limit) || 50, 1), MAX_MESSAGES_PAGE);
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        before
          ? sql`(${messageSortKey}, ${messages.id}) < (
              select coalesce(b.sent_at, b.created_at), b.id from ${messages} b
              where b.id = ${before} and b.conversation_id = ${conversationId})`
          : undefined,
      ),
    )
    .orderBy(desc(messageSortKey), desc(messages.id))
    .limit(size + 1);

  const page = rows.slice(0, size).reverse();
  return {
    hasMore: rows.length > size,
    messages: page.map(
      (m): MessageView => ({
        id: m.id,
        direction: m.direction,
        kind: m.type as MessageKind,
        body: m.body,
        attachments: m.attachments.map((a, i) => attachmentView(m.id, i, a, m.createdAt, now)),
        status: m.status,
        errorMessage: m.status === "failed" || m.errorCode ? m.errorMessage : null,
        canRetry: canRetry(m),
        sentAt: m.sentAt ?? m.createdAt,
        adReferral: sanitizeReferral(m.adReferral),
      }),
    ),
  };
}

/**
 * Marca como leído hasta `upToMessageId` (el último mensaje que la UI tiene a
 * la vista); sin él, hasta el último entrante guardado. Lo que llegue después
 * del corte sigue sin leer. Idempotente.
 */
export async function markConversationReadForOrg(
  organizationId: string,
  conversationId: string,
  upToMessageId?: string | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id, unreadCount: conversations.unreadCount })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
      .for("update");
    if (!conversation) return false;
    let cutoff: string | null = null;
    if (upToMessageId) {
      const [own] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.id, upToMessageId), eq(messages.conversationId, conversationId)))
        .limit(1);
      cutoff = own?.id ?? null;
    } else {
      cutoff = await latestInboundMessageId(conversationId, tx);
    }
    const unreadCount = await unreadAfterCutoff(tx, conversation, cutoff);
    if (unreadCount !== conversation.unreadCount) {
      await tx.update(conversations).set({ unreadCount }).where(eq(conversations.id, conversationId));
    }
    return true;
  });
}

export async function setConversationStarredForOrg(organizationId: string, conversationId: string, starred: boolean): Promise<boolean> {
  const updated = await db
    .update(conversations)
    .set({ isStarred: starred })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .returning({ id: conversations.id });
  return updated.length > 0;
}

export type { ConversationListItem };
