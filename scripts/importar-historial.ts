// Uso: npm run historial:importar -- --cuenta <accountId> [--simular] [opciones]
// Importa el historial del celular (coexistencia) de una cuenta de Zernio al canal del
// CRM, sin agente, workflows, no leídos, ventana ni primera respuesta, y rellena
// nombres vacíos con la agenda del celular (docs/go-live.md; docs/numero-prueba.md).
//
//   --simular        SOLO lectura: no escribe nada. Deja el reporte previo en .historial/
//                    (JSON completo + resumen de 10 líneas) y lo muestra.
//   --muestra <n>    con --simular: solo los n chats más recientes (reporte en ~2 min con 50;
//                    la duración se extrapola al total).
//   --sin-contactos  no lee la agenda del celular.
//   --desde-cero     ignora una corrida anterior sin terminar (por omisión, REANUDA).
//   --estado <ruta>  punto de reanudación (por omisión .historial/<cuenta>.estado.json).
//   --reporte <ruta> dónde guardar el reporte (por omisión .historial/<cuenta>-<modo>-<hora>.json).
//   --ritmo <n>      peticiones por minuto a Zernio (por omisión 40; el plan gratuito da 60
//                    y se comparten con el CRM en vivo).
//
// Ctrl+C una vez: termina la página en curso, guarda el avance y sale (código 3); el
// MISMO comando sigue donde se quedó. Idempotente (wamid único): repetirlo no duplica.
// La última línea de avance ("chat 350 de 1,200 · … · faltan ~N min") también queda en
// .historial/<cuenta>.avance.txt para verla sin la terminal.
// Necesita DATABASE_URL y ZERNIO_API_KEY (nunca se imprimen).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { importPhoneHistory, simulationSummary, type HistoryImportReport } from "@/lib/messaging/history-import";
import { fileStateStore } from "@/lib/messaging/history-state";
import { ZernioHistoryClient, ZernioHistoryError } from "@/lib/messaging/zernio-history";

const fmt = new Intl.NumberFormat("es-MX");

function importSummary(r: HistoryImportReport): string[] {
  const n = (v: number) => fmt.format(v);
  return [
    `Chats: ${n(r.conversaciones)} en Zernio; ${n(r.procesadas)} recorridos en esta corrida${r.reanudadas ? `, ${n(r.reanudadas)} ya terminados antes (reanudación)` : ""}.`,
    `Mensajes: ${n(r.importados)} nuevos; ${n(r.duplicados)} ya estaban (no se duplicaron).`,
    `Contactos: ${n(r.contactos.existentesGhl)} chats pegados a contactos de GHL, ${n(r.contactos.existentes)} a otros existentes, ${n(r.contactos.nuevos)} contactos nuevos, ${n(r.contactos.conversacionExistente)} a conversaciones ya en el CRM.`,
    `No importados: ${n(r.ambiguos.length)} ambiguos (más de un contacto con ese teléfono), ${n(r.sinTelefono.length)} sin teléfono válido, ${n(r.grupos)} grupos. Detalle en el reporte.`,
    `Agenda: ${n(r.agenda.leidos)} leídos, ${n(r.agenda.rellenados)} nombres vacíos rellenados.`,
    `Tiempo real: ${n(r.avisosEnLote)} aviso(s) en lote. Zernio: ${n(r.peticiones.requests)} peticiones, ${n(r.peticiones.throttled)} esperas por límite, ${n(r.peticiones.retries)} reintentos.`,
    r.cortado ? "CORTADO: el avance quedó guardado; corre el MISMO comando para seguir." : `Terminado en ${Math.max(1, Math.round(r.duracionMs / 60_000))} min.`,
  ];
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      cuenta: { type: "string" },
      simular: { type: "boolean", default: false },
      "sin-contactos": { type: "boolean", default: false },
      "desde-cero": { type: "boolean", default: false },
      estado: { type: "string" },
      reporte: { type: "string" },
      ritmo: { type: "string" },
      muestra: { type: "string" },
    },
  });
  const accountId = values.cuenta?.trim();
  // Solo el formato de un accountId de Zernio: también nombra los archivos de .historial/.
  if (!accountId || !/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) throw new Error("--cuenta <accountId de Zernio> es obligatorio");
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("Falta ZERNIO_API_KEY");
  const perMinute = values.ritmo ? Number(values.ritmo) : 40;
  if (!Number.isFinite(perMinute) || perMinute < 1 || perMinute > 600) throw new Error("--ritmo debe ser de 1 a 600 peticiones por minuto");

  const sample = values.muestra !== undefined ? Number(values.muestra) : undefined;
  if (sample !== undefined && (!values.simular || !Number.isInteger(sample) || sample < 1)) {
    throw new Error("--muestra <n> va con --simular y n es un número entero de chats (p. ej. --simular --muestra 50)");
  }

  // Avance visible fuera de la terminal: la última línea, con la hora.
  const progressPath = join(".historial", `${accountId}.avance.txt`);
  mkdirSync(".historial", { recursive: true, mode: 0o700 });
  const log = (line: string) => {
    console.log(`[historial] ${line}`);
    const stamp = new Date().toLocaleTimeString("es-MX", { timeZone: "America/Mazatlan", hour12: false });
    try {
      writeFileSync(progressPath, `${stamp} (hora de Mazatlán) · ${line}\n`, { mode: 0o600 });
    } catch {
      // el avance en archivo es opcional; la terminal ya lo mostró
    }
  };
  const client = new ZernioHistoryClient({
    apiKey,
    baseUrl: process.env.ZERNIO_BASE_URL,
    pacing: {
      minIntervalMs: Math.ceil(60_000 / perMinute),
      onWait: (ms, reason) => log(`esperando ${Math.round(ms / 1000)} s: ${reason}`),
    },
  });

  // Ctrl+C: la primera vez corta ordenado (guarda el avance); la segunda sale ya.
  const controller = new AbortController();
  process.on("SIGINT", () => {
    if (controller.signal.aborted) process.exit(130);
    log("cortando: termina la página en curso y guarda el avance (Ctrl+C otra vez para salir ya)…");
    controller.abort();
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const modo = values.simular ? (sample !== undefined ? `muestra${sample}` : "simulacion") : "importacion";
  const reportPath = values.reporte ?? join(".historial", `${accountId}-${modo}-${stamp}.json`);
  const report = await importPhoneHistory(client, accountId, {
    dryRun: values.simular,
    withContacts: !values["sin-contactos"],
    state: values.simular ? undefined : fileStateStore(values.estado ?? join(".historial", `${accountId}.estado.json`)),
    fromScratch: values["desde-cero"],
    signal: controller.signal,
    sample,
    log,
  });

  const summary = values.simular ? simulationSummary(report) : importSummary(report);
  // Los reportes traen teléfonos de clientes (ambiguos, sin teléfono): solo el dueño del archivo los lee.
  mkdirSync(dirname(reportPath), { recursive: true, mode: 0o700 });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  writeFileSync(reportPath.replace(/\.json$/, "") + ".txt", summary.join("\n") + "\n", { mode: 0o600 });
  console.log("");
  for (const line of summary) console.log(line);
  console.log("");
  console.log(`Reporte completo: ${reportPath}`);
  if (values.simular) console.log("Simulación: no se escribió nada.");
  if (report.cortado) return 3;
  return report.errores.length > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof ZernioHistoryError && error.retryable) {
      console.error("El avance quedó guardado: corre el MISMO comando más tarde para seguir.");
      process.exit(4);
    }
    process.exit(1);
  });
