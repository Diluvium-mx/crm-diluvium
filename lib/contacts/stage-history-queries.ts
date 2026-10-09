// Lectura del Historial de etapas (Dashboard › Historial de etapas, 9-oct-2026): los cambios de
// etapa de la organización, del más nuevo al más viejo, con filtros de periodo (días de
// Mazatlán), etapa a la que pasó, quién lo movió y buscador de contacto (sin acentos ni
// mayúsculas, lib/text/search.ts). Tope de STAGE_HISTORY_LIMIT filas, como el Historial del
// Agente IA: para ver más atrás se acorta el periodo.
import "server-only";

import { and, desc, eq, gte, isNull, like, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactStageHistory, contacts, user } from "@/lib/db/schema";
import { historyRange } from "@/lib/historial/labels";
import { SQL_SEARCH_FROM, SQL_SEARCH_TO, escapeLike, normalizeSearch } from "@/lib/text/search";

export const STAGE_HISTORY_LIMIT = 200;

/** Quién lo movió: "agente", "sistema" (automático, sin vendedor) o "u:<userId>". */
export type StageHistoryWho = "agente" | "sistema" | `u:${string}`;

export type StageHistoryFilters = {
  desde: string;
  hasta: string;
  etapa?: string | null;
  quien?: StageHistoryWho | null;
  q?: string | null;
};

export type StageHistoryRow = {
  id: string;
  at: Date;
  contactId: string;
  contactName: string;
  phone: string | null;
  fromName: string;
  toStage: string;
  toName: string;
  changedBy: string;
  who: string;
};

export function parseWho(raw: string | undefined): StageHistoryWho | null {
  if (raw === "agente" || raw === "sistema") return raw;
  if (raw?.startsWith("u:") && raw.length > 2 && raw.length <= 100) return raw as StageHistoryWho;
  return null;
}

/** Texto de «quién lo movió»: el vendedor con su nombre de ese momento, o el Agente IA, o Automático. */
export function whoLabel(row: { changedBy: string; userId: string | null; authorName: string | null; userName: string | null }): string {
  if (row.userId || row.authorName) return row.authorName ?? row.userName ?? "Vendedor";
  if (row.changedBy === "agente") return "Agente IA";
  if (row.changedBy === "sistema") return "Automático";
  return "Vendedor";
}

export async function listStageHistory(
  organizationId: string,
  filters: StageHistoryFilters,
): Promise<{ rows: StageHistoryRow[]; truncated: boolean }> {
  const { start, end } = historyRange(filters.desde, filters.hasta);
  const where: (SQL | undefined)[] = [eq(contactStageHistory.organizationId, organizationId)];
  if (start) where.push(gte(contactStageHistory.createdAt, start));
  if (end) where.push(lt(contactStageHistory.createdAt, end));
  if (filters.etapa) where.push(eq(contactStageHistory.toStage, filters.etapa));
  if (filters.quien === "agente") where.push(and(eq(contactStageHistory.changedBy, "agente"), isNull(contactStageHistory.userId)));
  else if (filters.quien === "sistema") where.push(and(eq(contactStageHistory.changedBy, "sistema"), isNull(contactStageHistory.userId)));
  else if (filters.quien) where.push(eq(contactStageHistory.userId, filters.quien.slice(2)));

  const name = sql<string>`coalesce(nullif(btrim(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})), ''), ${contacts.phoneE164}, 'sin nombre')`;
  const term = normalizeSearch(filters.q ?? "");
  if (term) {
    const byName = like(sql`lower(translate(${name}, ${SQL_SEARCH_FROM}, ${SQL_SEARCH_TO}))`, `%${escapeLike(term)}%`);
    const digits = term.replace(/\D/g, "");
    where.push(digits.length >= 3 ? or(byName, like(contacts.phoneE164, `%${digits}%`)) : byName);
  }

  const rows = await db
    .select({
      id: contactStageHistory.id,
      at: contactStageHistory.createdAt,
      contactId: contactStageHistory.contactId,
      contactName: name,
      phone: contacts.phoneE164,
      fromName: contactStageHistory.fromName,
      toStage: contactStageHistory.toStage,
      toName: contactStageHistory.toName,
      changedBy: contactStageHistory.changedBy,
      userId: contactStageHistory.userId,
      authorName: contactStageHistory.authorName,
      userName: user.name,
    })
    .from(contactStageHistory)
    .innerJoin(contacts, and(eq(contacts.id, contactStageHistory.contactId), eq(contacts.organizationId, contactStageHistory.organizationId)))
    .leftJoin(user, eq(user.id, contactStageHistory.userId))
    .where(and(...where))
    .orderBy(desc(contactStageHistory.createdAt), desc(contactStageHistory.id))
    .limit(STAGE_HISTORY_LIMIT + 1);

  return {
    rows: rows.slice(0, STAGE_HISTORY_LIMIT).map((r) => ({
      id: r.id,
      at: r.at,
      contactId: r.contactId,
      contactName: r.contactName,
      phone: r.phone,
      fromName: r.fromName,
      toStage: r.toStage,
      toName: r.toName,
      changedBy: r.changedBy,
      who: whoLabel(r),
    })),
    truncated: rows.length > STAGE_HISTORY_LIMIT,
  };
}
