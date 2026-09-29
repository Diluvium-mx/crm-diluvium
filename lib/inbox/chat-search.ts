// Búsqueda DENTRO de los chats (la lupa amarilla de la Bandeja y el Embudo, 29-sep-2026,
// decisión del dueño). Busca en todo lo que se ve del chat: mensajes del cliente, del
// vendedor, del Agente IA, historial importado, pies de foto y transcripciones de notas de
// voz. Fuera: los avisos internos (📝, no son parte de la conversación con el cliente), la
// sombra de un aviso "no disponible" (no es un mensaje) y los comentarios del contacto (otra
// tabla). Sin acentos, ñ ni mayúsculas, como todo buscador (lib/text/search.ts).
// Con la organización EXPLÍCITA, como queries.ts (la resuelve actions.ts desde la sesión).
import { and, desc, eq, inArray, like, ne, not, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { shadowNoticeSql } from "@/lib/messaging/unavailable";
import { searchRanges } from "@/lib/text/highlight";
import { escapeLike, SQL_SEARCH_FROM, SQL_SEARCH_TO } from "@/lib/text/search";

// Las letras van como LITERALES (no como parámetros): así la expresión es idéntica a la del
// índice messages_busqueda_idx (migración 0050, pg_trgm) y Postgres lo usa. Son constantes
// del código, nunca texto del usuario; sin comillas.
if (/'/.test(SQL_SEARCH_FROM + SQL_SEARCH_TO)) throw new Error("Las letras de búsqueda no pueden llevar comillas");
const FROM = sql.raw(`'${SQL_SEARCH_FROM}'`);
const TO = sql.raw(`'${SQL_SEARCH_TO}'`);

/** Texto buscable de un mensaje, normalizado. DEBE coincidir con la expresión del índice (0050). */
export const messageSearchText = sql`lower(translate(coalesce(${messages.body}, '') || ' ' || coalesce(${messages.transcripcion}, ''), ${FROM}, ${TO}))`;

// Orden del hilo (el mismo de queries.ts): hora de WhatsApp; si faltara, cuándo se guardó.
const messageSortKey = sql`coalesce(${messages.sentAt}, ${messages.createdAt})`;

// Tope de coincidencias que recorre la barra «1 de N» de un chat.
const MAX_MATCHES_PER_CHAT = 500;

/** Mensajes de la organización donde aparece `term` (ya normalizado con chatSearchTerm). */
function matchingMessages(organizationId: string, term: string): SQL {
  return and(
    eq(messages.organizationId, organizationId),
    ne(messages.type, "system_note"),
    not(shadowNoticeSql(messages.metadata)),
    like(messageSearchText, `%${escapeLike(term)}%`),
  )!;
}

/** Condición para la lista de la Bandeja: solo las conversaciones con la palabra. */
export function conversationsWithChatMatch(organizationId: string, term: string): SQL {
  return inArray(
    conversations.id,
    db.select({ id: messages.conversationId }).from(messages).where(matchingMessages(organizationId, term)),
  );
}

export type ChatMatch = { count: number; text: string };

/**
 * Por conversación (las de una página de la lista): cuántos mensajes tienen la palabra y el
 * texto de la coincidencia más reciente (para la vista previa de la fila).
 */
export async function chatMatchesForConversations(
  organizationId: string,
  conversationIds: string[],
  term: string,
): Promise<Map<string, ChatMatch>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      count: sql<number>`count(*) over (partition by ${messages.conversationId})`.mapWith(Number),
      body: messages.body,
      transcripcion: messages.transcripcion,
    })
    .from(messages)
    .where(and(matchingMessages(organizationId, term), inArray(messages.conversationId, conversationIds)))
    .orderBy(messages.conversationId, desc(messageSortKey), desc(messages.id));
  return new Map(
    rows.map((r) => {
      // La palabra pudo estar en el texto o en la transcripción de la nota de voz.
      const text = r.body && searchRanges(r.body, term).length > 0 ? r.body : (r.transcripcion ?? r.body ?? "");
      return [r.conversationId, { count: r.count, text }];
    }),
  );
}

/**
 * Embudo: por contacto (suma de todos sus chats, como el círculo de no leídos), cuántos
 * mensajes tienen la palabra. Solo los contactos con al menos uno.
 */
export async function searchChatsByContactForOrg(organizationId: string, term: string): Promise<Array<[string, number]>> {
  const rows = await db
    .select({ contactId: conversations.contactId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.organizationId, organizationId)))
    .where(matchingMessages(organizationId, term))
    .groupBy(conversations.contactId);
  return rows.map((r) => [r.contactId, r.count]);
}

/** Ids de los mensajes de un chat con la palabra, del más reciente al más viejo (barra «1 de N»). */
export async function listChatMatchIdsForOrg(organizationId: string, conversationId: string, term: string): Promise<string[]> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(matchingMessages(organizationId, term), eq(messages.conversationId, conversationId)))
    .orderBy(desc(messageSortKey), desc(messages.id))
    .limit(MAX_MATCHES_PER_CHAT);
  return rows.map((r) => r.id);
}
