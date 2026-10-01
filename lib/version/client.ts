// Aviso «Hay una nueva actualización del CRM» en el NAVEGADOR (1-oct-2026). Vigila las
// fallas de lo que hace el vendedor (peticiones al CRM que salieron justo después de un
// gesto suyo y archivos /_next/ que no cargan) y SOLO entonces pregunta a /api/version qué
// versión atiende el servidor. Si es otra que la de esta pestaña, prende el aviso
// (update-notice.tsx) hasta que se recargue. Sin falla del vendedor no pregunta nada: el
// aviso nunca sale solo por haber versión nueva ni por un refresco automático (decisión del dueño).
import {
  esArchivoDelCrm,
  esCancelacion,
  esDelCrm,
  esDelVendedor,
  esAccionNoEncontrada,
  esVersionDistinta,
  MENSAJE_ACTUALIZACION,
  senalDeRespuesta,
  VERSION_PATH,
} from "./rules";

// La marca de esta pestaña: la puso el build (next.config.ts) y no cambia hasta recargar.
const VERSION_LOCAL = process.env.NEXT_PUBLIC_CRM_VERSION ?? "";
// Tras una revisión con la misma versión, no se vuelve a preguntar antes de esto (varias
// fallas seguidas = una sola consulta).
const ESPERA_MS = 10_000;

declare global {
  interface Window {
    __crmVigilaVersion?: boolean;
  }
}

let actualizacion = false;
let enCurso: Promise<boolean> | null = null;
let ultimaRevision = 0;
let fetchOriginal: typeof fetch | null = null;
// Último gesto REAL del vendedor (eventos del navegador, no los que dispara un script).
let ultimoGesto: number | null = null;
const GESTOS = ["pointerdown", "pointerup", "keydown", "change", "drop", "paste", "submit"] as const;
const oyentes = new Set<() => void>();

export function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function hayActualizacion(): boolean {
  return actualizacion;
}

function prender(): void {
  if (actualizacion) return;
  actualizacion = true;
  for (const oyente of oyentes) oyente();
}

/**
 * ¿El servidor ya tiene otra versión? `segura`: la falla ya lo dice (acción que no existe);
 * se pregunta igual, y si no se puede preguntar (sin red) se da por hecho.
 */
export function revisarVersion(opciones: { segura?: boolean } = {}): Promise<boolean> {
  if (actualizacion) return Promise.resolve(true);
  if (enCurso) return enCurso;
  if (!opciones.segura && Date.now() - ultimaRevision < ESPERA_MS) return Promise.resolve(false);
  enCurso = (async () => {
    try {
      const res = await (fetchOriginal ?? fetch)(VERSION_PATH, { cache: "no-store" });
      const datos = (await res.json()) as { version?: unknown };
      if (esVersionDistinta(VERSION_LOCAL, datos.version) || opciones.segura) prender();
    } catch {
      if (opciones.segura) prender();
    } finally {
      ultimaRevision = Date.now();
      enCurso = null;
    }
    return actualizacion;
  })();
  return enCurso;
}

/** El mensaje para el lugar donde falló: el de la actualización si esa fue la causa; si no, el de siempre. */
export async function mensajeDeFalla(error: unknown, normal: string): Promise<string> {
  const nueva = await revisarVersion({ segura: esAccionNoEncontrada(error) });
  return nueva ? MENSAJE_ACTUALIZACION : normal;
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Instala la vigilancia una sola vez (instrumentation-client.ts, antes que cualquier página). */
export function vigilarFallas(): void {
  if (typeof window === "undefined" || window.__crmVigilaVersion) return;
  window.__crmVigilaVersion = true;
  for (const tipo of GESTOS) {
    document.addEventListener(
      tipo,
      (event) => {
        if (event.isTrusted) ultimoGesto = performance.now();
      },
      { capture: true, passive: true },
    );
  }
  const original = window.fetch.bind(window);
  fetchOriginal = original;
  // Solo observa: devuelve la misma respuesta (o el mismo error) que daría fetch.
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Los refrescos automáticos también fallan en una pestaña vieja, pero no cuentan.
    const delVendedor = esDelVendedor(performance.now(), ultimoGesto);
    let respuesta: Response;
    try {
      respuesta = await original(input, init);
    } catch (error) {
      if (delVendedor && !esCancelacion(error) && esDelCrm(urlDe(input), location.origin)) void revisarVersion();
      throw error;
    }
    if (!delVendedor) return respuesta;
    const senal = senalDeRespuesta(
      { url: respuesta.url || new URL(urlDe(input), location.href).href, status: respuesta.status, headers: respuesta.headers },
      location.origin,
    );
    if (senal) void revisarVersion({ segura: senal === "segura" });
    return respuesta;
  };
  // Un script o estilo del CRM que ya no existe (se pide el de la versión vieja): 404.
  window.addEventListener(
    "error",
    (event) => {
      const el = event.target;
      const url = el instanceof HTMLScriptElement ? el.src : el instanceof HTMLLinkElement ? el.href : "";
      if (url && esArchivoDelCrm(url, location.origin) && esDelVendedor(performance.now(), ultimoGesto)) void revisarVersion();
    },
    true,
  );
}
