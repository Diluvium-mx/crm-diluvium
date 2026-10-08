// Reprocesar eventos de WhatsApp guardados (lo usa scripts/replay-webhook-events.ts):
// 1) dead-letters y pendientes que NO están en cuarentena vuelven a la cola;
// 2) cuarentena (cuenta no permitida en este entorno): se libera SOLO si la cuenta del
//    evento ya está en la allowlist VIGENTE (p. ej. tras dar de alta un número). Las
//    demás siguen en cuarentena: el replay nunca salta la frontera entre entornos.
// Idempotente: un mensaje ya guardado no se duplica (wamid único). El worker los
// procesa en su próximo barrido (≤ 1 min).
// 3) dead-letters con el payload VACIADO (más de 30 días; ./dead-letter-retention.ts): se
//    SALTAN y se devuelven sus ids. Siguen en dead-letter (los cuenta el monitor igual).
import { and, eq, inArray, isNotNull, isNull, not } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { payloadEmptied } from "./dead-letter-retention";
import { isAccountAllowed } from "./index";
import { zernioAccountId } from "./zernio";

export type ReplayResult = { replayed: number; released: number; kept: number; emptied: string[] };

export async function replayWebhookEvents(allowed: ReadonlySet<string>, ids: string[] = []): Promise<ReplayResult> {
  const scope = ids.length ? inArray(webhookEvents.id, ids) : undefined;
  const candidates = and(scope, isNull(webhookEvents.quarantinedAt), ids.length ? undefined : isNull(webhookEvents.processedAt));

  // Sin payload no hay nada que reprocesar: se avisan y se dejan como están.
  const emptied = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(candidates, payloadEmptied()))
    .orderBy(webhookEvents.id);

  const replayed = await db
    .update(webhookEvents)
    .set({ attempts: 0, processedAt: null, lastError: null, deadLetteredAt: null, orphanWamid: null })
    .where(and(candidates, not(payloadEmptied())))
    .returning({ id: webhookEvents.id });

  const quarantined = await db
    .select({ id: webhookEvents.id, payload: webhookEvents.payload })
    .from(webhookEvents)
    .where(and(scope, isNotNull(webhookEvents.quarantinedAt), isNull(webhookEvents.processedAt), not(payloadEmptied())));
  let released = 0;
  let kept = 0;
  for (const row of quarantined) {
    if (!isAccountAllowed(zernioAccountId(row.payload), allowed)) {
      kept++;
      continue;
    }
    await db
      .update(webhookEvents)
      .set({ quarantinedAt: null, attempts: 0, lastError: null, deadLetteredAt: null })
      .where(eq(webhookEvents.id, row.id));
    released++;
  }
  return { replayed: replayed.length, released, kept, emptied: emptied.map((r) => r.id) };
}
