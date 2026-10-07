// Lectura del estado del Agente IA en segundo plano para UN contacto (solo lectura, fuera
// de lib/ai/runtime): sus chats de ESTA organización, qué tienen sin leer, si el lector los
// está leyendo (candado de Redis, tope 1.5 s: si Redis falla o tarda se asume que no) y su
// última lectura. Nunca lanza por Redis: el Detalle no se bloquea ni se rompe.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage, conversations, messages } from "@/lib/db/schema";
import { lectorLockKey } from "@/lib/ai/runtime/lector-core";
import { withQueueTimeout } from "@/lib/ai/runtime/queue";
import { isPending, resolveLectorStatus, type LectorConversationInfo, type LectorStatus } from "./lector-status";

/** Chats (de la lista) que el lector tiene tomados en este momento. */
export type LockReader = (conversationIds: readonly string[]) => Promise<Set<string>>;

export const readLectorLocks: LockReader = async (conversationIds) => {
  if (conversationIds.length === 0) return new Set();
  const { redis } = await import("@/lib/redis");
  const values = await withQueueTimeout(redis.mget(...conversationIds.map(lectorLockKey)), "leer el candado del lector");
  return new Set(conversationIds.filter((_, i) => values[i] !== null));
};

export type LectorStatusView = { status: LectorStatus; conversationIds: string[] };

export async function loadLectorStatus(organizationId: string, contactId: string, now: Date, readLocks: LockReader = readLectorLocks): Promise<LectorStatusView> {
  const convs = await db
    .select({ id: conversations.id, lastMessageAt: conversations.lastMessageAt, leidoHasta: conversations.detalleLeidoHasta })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.contactId, contactId)));
  const ids = convs.map((c) => c.id);
  if (ids.length === 0) return { status: null, conversationIds: [] };

  let locked = new Set<string>();
  try {
    locked = await readLocks(ids);
  } catch {
    locked = new Set(); // Redis caído o lento: como si nadie estuviera leyendo
  }
  // Última lectura por chat (índice ai_usage_conversation_created_idx).
  const reads = await db
    .selectDistinctOn([aiUsage.conversationId], { conversationId: aiUsage.conversationId, at: aiUsage.createdAt, outcome: aiUsage.outcome })
    .from(aiUsage)
    .where(and(eq(aiUsage.organizationId, organizationId), eq(aiUsage.stage, "detalle"), inArray(aiUsage.conversationId, ids)))
    .orderBy(aiUsage.conversationId, desc(aiUsage.createdAt));
  const lastRead = new Map(reads.map((r) => [r.conversationId, { at: r.at, ok: r.outcome !== "error" }]));

  const infos: LectorConversationInfo[] = [];
  for (const c of convs) {
    const info: LectorConversationInfo = {
      conversationId: c.id,
      lastMessageAt: c.lastMessageAt,
      leidoHasta: c.leidoHasta,
      firstUnreadAt: null,
      reading: locked.has(c.id),
      lastRead: lastRead.get(c.id) ?? null,
    };
    // El primer mensaje sin leer solo hace falta para calcular la espera.
    if (isPending(info, now)) {
      const [row] = await db
        // La hora del mensaje (mismo reloj que detalle_leido_hasta y el barrido), no la de llegada.
        .select({ first: sql<Date | null>`min(coalesce(${messages.sentAt}, ${messages.createdAt}))`.mapWith(messages.createdAt) })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, organizationId),
            eq(messages.conversationId, c.id),
            c.leidoHasta ? sql`coalesce(${messages.sentAt}, ${messages.createdAt}) > ${c.leidoHasta.toISOString()}::timestamp` : sql`true`,
          ),
        );
      info.firstUnreadAt = row?.first ?? null;
    }
    infos.push(info);
  }
  return { status: resolveLectorStatus(infos, now), conversationIds: ids };
}
