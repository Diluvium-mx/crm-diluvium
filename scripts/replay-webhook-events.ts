// Uso: npm run webhooks:replay -- [id-del-evento ...]
// Reactiva eventos de WhatsApp en dead-letter (agotaron intentos o se
// marcaron con error) para que el barrido del worker los vuelva a procesar,
// p. ej. después de configurar un canal que faltaba. Sin argumentos: todos los
// pendientes. Idempotente: un mensaje ya guardado no se duplica (wamid único).
//
// Cuarentena (cuenta no permitida en este entorno): se libera SOLO si la
// cuenta del evento ya está en ZERNIO_ALLOWED_ACCOUNT_IDS de este entorno
// (p. ej. tras dar de alta el número real). Las demás siguen en cuarentena:
// el replay nunca salta la frontera entre entornos. Lógica: lib/messaging/replay.ts.
//
// Dead-letters de más de 30 días: su payload ya se vació (datos personales;
// lib/messaging/dead-letter-retention.ts). No se pueden reprocesar: se saltan y se
// listan, sin fallar.
import { allowedAccountIds } from "@/lib/messaging";
import { EMPTIED_PAYLOAD_NOTICE } from "@/lib/messaging/dead-letter-retention";
import { replayWebhookEvents } from "@/lib/messaging/replay";
import { logError } from "@/lib/log/safe-error";

const MAX_IDS_SHOWN = 20;

async function main() {
  const { replayed, released, kept, emptied } = await replayWebhookEvents(allowedAccountIds(), process.argv.slice(2));
  console.log(
    `${replayed} evento(s) reactivados, ${released} liberado(s) de cuarentena, ` +
      `${kept} siguen en cuarentena (cuenta no permitida aquí). El worker los procesa en el próximo barrido (≤ 1 min).`,
  );
  if (emptied.length) {
    const shown = emptied.slice(0, MAX_IDS_SHOWN).join(", ");
    const more = emptied.length > MAX_IDS_SHOWN ? ` y ${emptied.length - MAX_IDS_SHOWN} más` : "";
    console.log(`${emptied.length} evento(s) saltados: ${EMPTIED_PAYLOAD_NOTICE}. Siguen en dead-letter: ${shown}${more}.`);
  }
  process.exit(0);
}

main().catch((error) => {
  logError("[webhooks:replay]", error);
  process.exit(1);
});
