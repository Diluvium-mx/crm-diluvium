// Uso: npm run historial:importar -- --cuenta <accountId> [--simular] [--sin-contactos]
// Importa el historial del celular (coexistencia) de una cuenta de Zernio al canal del
// CRM, sin agente, workflows, no leídos, ventana ni primera respuesta, y rellena
// nombres vacíos con la agenda del celular (docs/numero-prueba.md, paso 5).
// --simular: solo lee Zernio y muestra cuántos mensajes y una muestra de fechas; no escribe.
// Idempotente (wamid único): repetirlo no duplica. Necesita DATABASE_URL y ZERNIO_API_KEY.
import { parseArgs } from "node:util";
import { importPhoneHistory } from "@/lib/messaging/history-import";
import { ZernioHistoryClient } from "@/lib/messaging/zernio-history";

async function main() {
  const { values } = parseArgs({
    options: {
      cuenta: { type: "string" },
      simular: { type: "boolean", default: false },
      "sin-contactos": { type: "boolean", default: false },
    },
  });
  const accountId = values.cuenta?.trim();
  if (!accountId) throw new Error("--cuenta <accountId de Zernio> es obligatorio");
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("Falta ZERNIO_API_KEY");

  const client = new ZernioHistoryClient({ apiKey, baseUrl: process.env.ZERNIO_BASE_URL });
  const report = await importPhoneHistory(client, accountId, {
    dryRun: values.simular,
    withContacts: !values["sin-contactos"],
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(report, null, 2));
  if (values.simular) console.log("Simulación: no se escribió nada.");
  process.exit(report.errores.length > 0 ? 2 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
