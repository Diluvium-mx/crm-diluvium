// Uso: npx tsx scripts/replay-webhook-events.ts [id-del-evento ...]
// Reactiva eventos de WhatsApp en dead-letter (agotaron intentos o se
// marcaron con error) para que el barrido del worker los vuelva a procesar,
// p. ej. después de configurar un canal que faltaba. Sin argumentos: todos los
// pendientes. Idempotente: un mensaje ya guardado no se duplica (wamid único).
//
// Cuarentena (cuenta no permitida en este entorno): se libera SOLO si la
// cuenta del evento ya está en ZERNIO_ALLOWED_ACCOUNT_IDS de este entorno
// (p. ej. tras dar de alta el número real). Las demás siguen en cuarentena:
// el replay nunca salta la frontera entre entornos.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { allowedAccountIds, isAccountAllowed } from "@/lib/messaging";
import { zernioAccountId } from "@/lib/messaging/zernio";

async function main() {
  const ids = process.argv.slice(2);
  const scope = ids.length ? inArray(webhookEvents.id, ids) : undefined;

  // 1) Dead-letters y pendientes que NO están en cuarentena.
  const replayed = await db
    .update(webhookEvents)
    .set({ attempts: 0, processedAt: null, lastError: null, deadLetteredAt: null, orphanWamid: null })
    .where(and(scope, isNull(webhookEvents.quarantinedAt), ids.length ? undefined : isNull(webhookEvents.processedAt)))
    .returning({ id: webhookEvents.id });

  // 2) Cuarentena: solo las cuentas que la allowlist VIGENTE ya permite.
  const allowed = allowedAccountIds();
  const quarantined = await db
    .select({ id: webhookEvents.id, payload: webhookEvents.payload })
    .from(webhookEvents)
    .where(and(scope, isNotNull(webhookEvents.quarantinedAt), isNull(webhookEvents.processedAt)));
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

  console.log(
    `${replayed.length} evento(s) reactivados, ${released} liberado(s) de cuarentena, ` +
      `${kept} siguen en cuarentena (cuenta no permitida aquí). El worker los procesa en el próximo barrido (≤ 1 min).`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
