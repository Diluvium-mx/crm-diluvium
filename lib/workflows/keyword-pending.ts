import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import type { Tx } from "@/lib/messaging/ingest";

// Palabra clave DURABLE (revisión completa B1, 28-sep-2026). El disparo por palabra clave corre
// después del commit del mensaje; un reinicio del worker justo en medio lo perdía (el reintento ve
// el wamid repetido y no vuelve a disparar). Ahora el entrante de texto nace con
// messages.metadata.palabraClave = "pendiente" en la MISMA transacción; el gancho la cierra
// ("revisada") tras evaluar, y el barrido de workflows retoma las pendientes de 1 a 30 min.
// Dos evaluaciones del mismo mensaje no duplican la corrida: índice único por mensaje (0046).
export const KEYWORD_META = "palabraClave";
/** El barrido solo toma pendientes con más de 1 min (el gancho normal tarda milisegundos)… */
export const KEYWORD_SWEEP_MIN_AGE_MS = 60_000;
/** …y con menos de 30 min: una tabla que llega media hora tarde ya no sirve al cliente. */
export const KEYWORD_SWEEP_MAX_AGE_MS = 30 * 60_000;

export async function markKeywordPending(tx: Tx, messageId: string): Promise<void> {
  await tx
    .update(messages)
    .set({ metadata: sql`jsonb_set(coalesce(${messages.metadata}, '{}'::jsonb), '{${sql.raw(KEYWORD_META)}}', '"pendiente"')` })
    .where(eq(messages.id, messageId));
}

export async function markKeywordChecked(m: { organizationId: string; messageId: string }): Promise<void> {
  await db
    .update(messages)
    .set({ metadata: sql`jsonb_set(${messages.metadata}, '{${sql.raw(KEYWORD_META)}}', '"revisada"')` })
    .where(
      and(
        eq(messages.id, m.messageId),
        eq(messages.organizationId, m.organizationId),
        sql`${messages.metadata}->>${KEYWORD_META} = 'pendiente'`,
      ),
    );
}

/** Entrantes cuya palabra clave quedó sin evaluar (worker reiniciado entre el commit y el gancho). */
export async function pendingKeywordMessages(
  now = new Date(),
): Promise<{ organizationId: string; conversationId: string; messageId: string }[]> {
  return db
    .select({ organizationId: messages.organizationId, conversationId: messages.conversationId, messageId: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "in"),
        sql`${messages.metadata}->>${KEYWORD_META} = 'pendiente'`,
        gte(messages.createdAt, new Date(now.getTime() - KEYWORD_SWEEP_MAX_AGE_MS)),
        lt(messages.createdAt, new Date(now.getTime() - KEYWORD_SWEEP_MIN_AGE_MS)),
      ),
    )
    .orderBy(messages.createdAt)
    .limit(50);
}
