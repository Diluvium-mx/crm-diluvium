// Uso: npm run historial:instagram -- --cuenta <accountId> [--simular] [--desde-cero] [--ritmo <n>]
// Importa al CRM los chats de Instagram que Zernio copió al conectar la cuenta (últimos 500,
// hasta 500 mensajes c/u) como HISTORIAL: sin Agente IA, workflows ni no leídos
// (docs/instagram.md, lib/messaging/instagram-history.ts).
//
//   --simular      SOLO lectura: no escribe nada; muestra lo que entraría.
//   --desde-cero   ignora una corrida anterior sin terminar (por omisión, REANUDA).
//   --ritmo <n>    peticiones por minuto a Zernio (por omisión 40; el CRM en vivo usa el resto).
//
// Ctrl+C una vez: termina la página en curso, guarda el avance y sale (código 3); el MISMO
// comando sigue donde se quedó. Idempotente (id de Meta único): repetirlo no duplica.
// Necesita DATABASE_URL y ZERNIO_API_KEY (nunca se imprimen).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { importInstagramHistory, instagramHistorySummary } from "@/lib/messaging/instagram-history";
import { fileStateStore } from "@/lib/messaging/history-state";
import { ZernioHistoryClient, ZernioHistoryError } from "@/lib/messaging/zernio-history";
import { safeErrorMessage } from "@/lib/log/safe-error";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      cuenta: { type: "string" },
      simular: { type: "boolean", default: false },
      "desde-cero": { type: "boolean", default: false },
      ritmo: { type: "string" },
    },
  });
  const accountId = values.cuenta?.trim();
  if (!accountId || !/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) throw new Error("--cuenta <accountId de Zernio> es obligatorio");
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("Falta ZERNIO_API_KEY");
  const perMinute = values.ritmo ? Number(values.ritmo) : 40;
  if (!Number.isFinite(perMinute) || perMinute < 1 || perMinute > 600) throw new Error("--ritmo debe ser de 1 a 600 peticiones por minuto");

  const log = (line: string) => console.log(`[historial instagram] ${line}`);
  const client = new ZernioHistoryClient({
    apiKey,
    baseUrl: process.env.ZERNIO_BASE_URL,
    pacing: { minIntervalMs: Math.ceil(60_000 / perMinute), onWait: (ms, reason) => log(`esperando ${Math.round(ms / 1000)} s: ${reason}`) },
  });
  const controller = new AbortController();
  process.on("SIGINT", () => {
    if (controller.signal.aborted) process.exit(130);
    log("cortando: termina la página en curso y guarda el avance (Ctrl+C otra vez para salir ya)…");
    controller.abort();
  });

  mkdirSync(".historial", { recursive: true, mode: 0o700 });
  const report = await importInstagramHistory(client, accountId, {
    dryRun: values.simular,
    state: values.simular ? undefined : fileStateStore(join(".historial", `${accountId}.instagram.estado.json`)),
    fromScratch: values["desde-cero"],
    signal: controller.signal,
    log,
  });
  console.log("");
  for (const line of instagramHistorySummary(report)) console.log(line);
  if (values.simular) console.log("Simulación: no se escribió nada.");
  if (report.cortado) return 3;
  return report.errores.length > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    if (error instanceof ZernioHistoryError && error.retryable) {
      console.error("El avance quedó guardado: corre el MISMO comando más tarde para seguir.");
      process.exit(4);
    }
    process.exit(1);
  });
