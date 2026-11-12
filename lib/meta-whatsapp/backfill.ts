// Relleno de la marca de Meta con los avisos de estado que todavía guarda webhook_events (se borran a los 7 días;
// docs/meta-whatsapp.md). Lo corre el worker al arrancar: le pone la marca a los salientes de esos días que no la
// tienen. Nunca pisa una marca que ya llegó en vivo y nunca cruza organizaciones (el aviso se liga por su wamid
// dentro de la organización del aviso). Se puede correr las veces que sea.
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, webhookEvents } from "@/lib/db/schema";
import { metaMarkColumns, parseMetaMark } from "@/lib/messaging/meta-mark";

const STATUS_EVENTS = ["message.sent", "message.delivered", "message.read", "message.failed"];
const BATCH = 500;
const DAYS = 8;

export async function backfillMetaMarks(options: { now?: Date } = {}): Promise<{ events: number; marked: number }> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  let events = 0;
  let marked = 0;
  let after = "";
  for (;;) {
    const rows = await db
      .select({ id: webhookEvents.id, organizationId: webhookEvents.organizationId, payload: webhookEvents.payload })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, "zernio"),
          inArray(webhookEvents.event, STATUS_EVENTS),
          isNotNull(webhookEvents.organizationId),
          gte(webhookEvents.receivedAt, since),
          sql`${webhookEvents.id} > ${after}`,
          sql`(jsonb_typeof(${webhookEvents.payload}->'pricing') = 'object' or jsonb_typeof(${webhookEvents.payload}->'billingConversation') = 'object')`,
          // Los que ya tienen marca no se vuelven a revisar: tras el primer arranque casi no queda nada.
          sql`not exists (select 1 from messages m where m.provider_message_id = ${webhookEvents.payload}->'message'->>'platformMessageId' and m.meta_category is not null)`,
        ),
      )
      .orderBy(webhookEvents.id)
      .limit(BATCH);
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    for (const row of rows) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const mark = parseMetaMark(payload);
      const message = (payload.message ?? {}) as Record<string, unknown>;
      const id = message.platformMessageId ?? payload.platformMessageId;
      const wamid = typeof id === "string" && id ? id : null;
      if (!mark || !wamid || !row.organizationId) continue;
      events++;
      const updated = await db
        .update(messages)
        .set(metaMarkColumns(mark))
        .where(
          and(
            eq(messages.providerMessageId, wamid),
            eq(messages.organizationId, row.organizationId),
            eq(messages.direction, "out"),
            isNull(messages.metaCategory),
          ),
        )
        .returning({ id: messages.id });
      marked += updated.length;
    }
  }
  return { events, marked };
}
