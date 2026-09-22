// Uso: npx tsx scripts/replay-webhook-events.ts [id-del-evento ...]
// Reactiva eventos de WhatsApp en dead-letter (agotaron intentos o se
// marcaron con error) para que el barrido del worker los vuelva a procesar,
// p. ej. después de configurar un canal que faltaba. Sin argumentos: todos los
// pendientes. Idempotente: un mensaje ya guardado no se duplica (wamid único).
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";

async function main() {
  const ids = process.argv.slice(2);
  const where = ids.length
    ? inArray(webhookEvents.id, ids)
    : and(isNull(webhookEvents.processedAt));
  const rows = await db
    .update(webhookEvents)
    .set({ attempts: 0, processedAt: null, lastError: null, deadLetteredAt: null })
    .where(where)
    .returning({ id: webhookEvents.id });
  console.log(`${rows.length} evento(s) reactivados; el worker los procesa en el próximo barrido (≤ 1 min).`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
