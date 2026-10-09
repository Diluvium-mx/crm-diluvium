// Acciones lentas en el log (9-oct-2026). El 9-oct hubo acciones del Embudo de 1 a 16 s con el
// servidor en reposo, y los registros HTTP de Railway solo dicen «POST /embudo»: no qué acción
// era. Aquí cada Server Action se mide desde requireActiveMembership() (todas pasan por ahí)
// hasta que su respuesta termina (after) y, si tardó SLOW_ACTION_MS o más, sale en el log:
//   [lenta] getAgentActivity 2310 ms · /embudo
// Sin datos de clientes: el nombre sale del manifiesto de Next (id → nombre exportado) y la
// pantalla es solo la ruta, sin ?contacto=… ni nada más.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "next/server";

export const SLOW_ACTION_MS = 1_000;

type Manifest = { node?: Record<string, { exportedName?: string; filename?: string }> };

let names: Map<string, string> | null = null;

/** Nombre legible de la acción (`archivo › export`); sin manifiesto, el inicio del id. */
export function actionName(actionId: string, load: () => Manifest = readManifest): string {
  if (!names) {
    names = new Map();
    try {
      for (const [id, entry] of Object.entries(load().node ?? {})) {
        if (entry.exportedName) names.set(id, entry.filename ? `${shortFile(entry.filename)} › ${entry.exportedName}` : entry.exportedName);
      }
    } catch {
      // Sin manifiesto (pruebas, dev sin build): queda el id.
    }
  }
  return names.get(actionId) ?? `acción ${actionId.slice(0, 10)}`;
}

/** Solo para pruebas: olvida los nombres leídos. */
export function resetActionNames(): void {
  names = null;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(process.cwd(), ".next", "server", "server-reference-manifest.json"), "utf8")) as Manifest;
}

// lib/actions/contacts.ts → contacts
function shortFile(filename: string): string {
  return filename.replace(/^.*\//, "").replace(/\.tsx?$/, "");
}

/** La pantalla desde la que se llamó: solo la ruta (sin query ni dominio). */
export function screenPath(referer: string | null): string {
  if (!referer) return "?";
  try {
    return new URL(referer).pathname;
  } catch {
    return "?";
  }
}

// Una medición por petición: requireActiveMembership() puede correr varias veces en la misma
// acción (y otra vez si la acción re-renderiza la página). Next da el MISMO objeto de headers
// durante toda la petición.
const timed = new WeakSet<object>();

/** Empieza a medir si esta petición es una Server Action; no hace nada en páginas ni rutas. */
export function timeServerAction(requestHeaders: Headers): void {
  const actionId = requestHeaders.get("next-action");
  if (!actionId || timed.has(requestHeaders)) return;
  timed.add(requestHeaders);
  const start = performance.now();
  const screen = screenPath(requestHeaders.get("referer"));
  after(() => {
    const ms = Math.round(performance.now() - start);
    if (ms >= SLOW_ACTION_MS) console.warn(`[lenta] ${actionName(actionId)} ${ms} ms · ${screen}`);
  });
}
