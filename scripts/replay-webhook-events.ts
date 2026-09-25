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
import { allowedAccountIds } from "@/lib/messaging";
import { replayWebhookEvents } from "@/lib/messaging/replay";

async function main() {
  const { replayed, released, kept } = await replayWebhookEvents(allowedAccountIds(), process.argv.slice(2));
  console.log(
    `${replayed} evento(s) reactivados, ${released} liberado(s) de cuarentena, ` +
      `${kept} siguen en cuarentena (cuenta no permitida aquí). El worker los procesa en el próximo barrido (≤ 1 min).`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
