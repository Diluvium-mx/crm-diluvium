// «Solo lectura» en el NAVEGADOR (26-nov-2026, lib/auth/solo-lectura.ts). Solo se instala en la
// pestaña de ese rol (components/solo-lectura/aviso-solo-lectura.tsx). Dos cosas:
// 1. El aviso «Modo solo lectura: no se guardó nada» cuando el servidor rechaza algo: lo reconoce
//    en la respuesta misma (Server Action con el digest SOLO_LECTURA o ruta con x-solo-lectura), así
//    sale sin importar cómo maneje el error cada pantalla.
// 2. Descargas de datos de clientes («Exportar datos», «Descargar» del visor, la foto girada): en vez de bajar
//    un archivo (o uno roto: la ruta lo rechaza), sale el aviso. Todo <a download> cuenta.
// 3. No deja escribir fuera de los buscadores (`type="search"` o dentro de `data-buscador`): la caja
//    queda de solo lectura al enfocarla (se puede seleccionar y copiar) y al intentar teclear, pegar
//    o soltar algo sale el mismo aviso.
// Lo que de verdad impide guardar es el servidor; esto es para que se entienda qué pasó.
import { esDescargaBloqueada, esRechazoSoloLectura, SOLO_LECTURA_DIGEST, SOLO_LECTURA_HEADER } from "@/lib/auth/solo-lectura";

/** Cuánto se ve el aviso. */
export const AVISO_MS = 2_600;

declare global {
  interface Window {
    __crmSoloLectura?: boolean;
  }
}

let visible = false;
let apagar: ReturnType<typeof setTimeout> | null = null;
const oyentes = new Set<() => void>();

export function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function avisoVisible(): boolean {
  return visible;
}

function cambiar(valor: boolean): void {
  if (visible === valor) return;
  visible = valor;
  for (const oyente of oyentes) oyente();
}

/** Muestra el aviso (si ya está, solo alarga su tiempo). */
export function avisar(): void {
  if (apagar) clearTimeout(apagar);
  cambiar(true);
  apagar = setTimeout(() => {
    apagar = null;
    cambiar(false);
  }, AVISO_MS);
}

// Cajas donde se escribe texto. Las demás (casillas, opciones, archivos, rangos) son botones.
const TIPOS_DE_TEXTO = new Set(["", "text", "email", "tel", "url", "number", "password", "date", "time", "datetime-local", "month", "week"]);

/** Lo que se lee del elemento (así se prueba sin navegador). */
type Caja = Pick<Element, "tagName" | "closest"> & { type?: string; isContentEditable?: boolean; readOnly?: boolean };

/** ¿El elemento es una caja de texto que este rol NO puede usar (todas menos los buscadores)? */
export function esCajaBloqueada(el: Caja | null): el is Caja {
  if (!el) return false;
  if (el.closest("[data-buscador]")) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return TIPOS_DE_TEXTO.has((el.type ?? "").toLowerCase());
  return el.isContentEditable === true;
}

/** ¿La tecla escribe o borra algo? (Las de moverse, copiar o salir no cuentan.) */
export function esTeclaQueEscribe(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (event.key === "Backspace" || event.key === "Delete") return true;
  if (event.metaKey || event.ctrlKey) return event.key.toLowerCase() === "v" || event.key.toLowerCase() === "x";
  return event.key.length === 1;
}

/** ¿La respuesta es un rechazo de solo lectura? Las Server Actions rechazadas responden 500 con el digest. */
export async function esRespuestaRechazada(respuesta: Response, esAccion: boolean): Promise<boolean> {
  if (respuesta.headers.get(SOLO_LECTURA_HEADER) === "1") return true;
  if (!esAccion || respuesta.status !== 500) return false;
  try {
    return (await respuesta.clone().text()).includes(`"${SOLO_LECTURA_DIGEST}"`);
  } catch {
    return false;
  }
}

function esServerAction(init?: RequestInit): boolean {
  try {
    return new Headers(init?.headers).has("next-action");
  } catch {
    return false;
  }
}

function bloquear(el: Caja): void {
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") el.readOnly = true;
}

/** Instala todo una sola vez por pestaña. */
export function instalarSoloLectura(): void {
  if (typeof window === "undefined" || window.__crmSoloLectura) return;
  window.__crmSoloLectura = true;

  // Solo observa: devuelve la misma respuesta (o el mismo error) que daría fetch.
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const respuesta = await original(input, init);
    void esRespuestaRechazada(respuesta, esServerAction(init)).then((rechazada) => {
      if (rechazada) avisar();
    });
    return respuesta;
  };

  // El rechazo que ninguna pantalla atrapó: ya se avisó; que no salga como error.
  window.addEventListener("unhandledrejection", (event) => {
    if (esRechazoSoloLectura(event.reason)) event.preventDefault();
  });

  const objetivo = (event: Event) => (event.target instanceof Element ? event.target : null);
  // Incluye el <a download> que se crea y se presiona por código (export-contact-dialog.tsx, viewer-rotated-download.ts).
  document.addEventListener(
    "click",
    (event) => {
      const enlace = objetivo(event)?.closest("a[href]");
      if (!enlace || !(enlace.hasAttribute("download") || esDescargaBloqueada(enlace.getAttribute("href") ?? ""))) return;
      event.preventDefault();
      avisar();
    },
    true,
  );
  document.addEventListener(
    "focusin",
    (event) => {
      const el = objetivo(event);
      if (esCajaBloqueada(el)) bloquear(el);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const el = objetivo(event);
      if (!esCajaBloqueada(el) || !esTeclaQueEscribe(event)) return;
      bloquear(el);
      event.preventDefault();
      avisar();
    },
    true,
  );
  for (const tipo of ["paste", "cut", "drop", "beforeinput"] as const) {
    document.addEventListener(
      tipo,
      (event) => {
        const el = objetivo(event);
        if (!esCajaBloqueada(el)) return;
        event.preventDefault();
        avisar();
      },
      true,
    );
  }
}
