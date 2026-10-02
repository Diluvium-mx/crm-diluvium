// Cursor y letras al escribir en el NAVEGADOR (2-oct-2026, decisión del dueño). Una sola
// pieza para TODAS las cajas de texto del CRM, sin tocar ningún componente: al enfocar una
// caja animable (rules.ts) se pone una capa encima, del tamaño exacto de la caja, que
// dibuja las letras (las nuevas con desvanecido) y un cursor azul de 2 px que parpadea
// suave y se desliza en los saltos. La caja real sigue siendo la que recibe el teclado
// (acentos, ñ, dictado, autocorrector, deshacer); solo se vuelven transparentes sus letras
// y su cursor. Al salir de la caja la capa se quita y la caja queda tal como estaba: bordes,
// colores e iluminación no cambian nunca (pedido del dueño).
// Sin animación: celular y tabletas (su cursor trae las agarraderas para mover el texto) y
// «Reducir movimiento» del sistema. Prototipo verificado: notas/cursor-animado/final.html.
import {
  DESLIZ_MS,
  TECLEO_MS,
  esCajaAnimable,
  esSalto,
  nacimientos,
  renglonDeCajaUnica,
  tramos,
  type Punto,
} from "./rules";

type CajaDeTexto = HTMLTextAreaElement | HTMLInputElement;

declare global {
  interface Window {
    __crmEscritura?: boolean;
  }
}

// Lo que se copia de la caja a las capas para que las letras caigan en el mismo pixel.
const PROPIEDADES = [
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-family",
  "font-kerning",
  "font-feature-settings",
  "font-variation-settings",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
  "text-align",
  "text-rendering",
  "tab-size",
  "direction",
  "color",
  "-webkit-font-smoothing",
] as const;

// Lo que se le cambia a la caja mientras tiene la capa encima (y se le regresa al salir).
const OCULTAR = ["-webkit-text-fill-color", "caret-color"] as const;

function cumpleElEquipo(): boolean {
  return (
    window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function esCaja(nodo: EventTarget | null): nodo is CajaDeTexto {
  return nodo instanceof HTMLTextAreaElement || nodo instanceof HTMLInputElement;
}

function animable(caja: CajaDeTexto): boolean {
  if (caja.closest("[data-sin-escritura]")) return false;
  return esCajaAnimable({
    etiqueta: caja.tagName,
    tipo: caja instanceof HTMLInputElement ? caja.type : "",
    soloLectura: caja.readOnly,
    deshabilitada: caja.disabled,
  });
}

function autollenada(caja: CajaDeTexto): boolean {
  try {
    return caja.matches(":autofill");
  } catch {
    try {
      return caja.matches(":-webkit-autofill");
    } catch {
      return false;
    }
  }
}

/**
 * Los buscadores (type="search") guardan a la derecha el lugar de su ✕ aunque no se vea; el
 * texto se corta antes. Se mide con dos cajas ocultas iguales, una de texto y otra de búsqueda.
 */
function reservaDeLaEquis(caja: CajaDeTexto): number {
  if (!(caja instanceof HTMLInputElement) || caja.type !== "search" || !caja.parentElement) return 0;
  const ancho = px(caja.getBoundingClientRect().width);
  const medir = (tipo: string): number => {
    const prueba = document.createElement("input");
    prueba.type = tipo;
    prueba.className = caja.className;
    prueba.value = "M".repeat(200);
    prueba.tabIndex = -1;
    prueba.setAttribute("aria-hidden", "true");
    estilo(prueba, { position: "absolute", visibility: "hidden", "pointer-events": "none", width: ancho, left: "0px", top: "0px" });
    caja.parentElement?.appendChild(prueba);
    const medida = prueba.scrollWidth;
    prueba.remove();
    return medida;
  };
  return Math.max(0, medir("search") - medir("text"));
}

function px(valor: number): string {
  return `${valor}px`;
}

function estilo(nodo: HTMLElement, propiedades: Record<string, string>): void {
  for (const [nombre, valor] of Object.entries(propiedades)) nodo.style.setProperty(nombre, valor);
}

/** Pone la capa sobre la caja; devuelve la función que la quita. */
function adjuntar(caja: CajaDeTexto): () => void {
  const unRenglon = caja instanceof HTMLInputElement;
  const raiz = document.createElement("span");
  const medida = document.createElement("span");
  const letras = document.createElement("span");
  const cursor = document.createElement("span");
  raiz.setAttribute("aria-hidden", "true");
  raiz.className = "escritura-raiz";
  medida.className = "escritura-capa";
  letras.className = "escritura-capa";
  cursor.className = "escritura-cursor";
  medida.style.setProperty("visibility", "hidden");
  cursor.appendChild(document.createElement("span"));
  raiz.append(medida, letras, cursor);
  estilo(raiz, {
    position: "absolute",
    display: "block",
    left: "0px",
    top: "0px",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    "pointer-events": "none",
    "z-index": String((Number.parseInt(getComputedStyle(caja).zIndex, 10) || 0) + 1),
  });
  // ANTES de la caja: así no cambia quién es el último hijo (los espaciados de Tailwind
  // se fijan en eso) y la capa, por estar posicionada, se pinta encima.
  caja.before(raiz);

  const previos = new Map<string, { valor: string; prioridad: string }>();
  for (const nombre of OCULTAR) {
    previos.set(nombre, { valor: caja.style.getPropertyValue(nombre), prioridad: caja.style.getPropertyPriority(nombre) });
    caja.style.setProperty(nombre, "transparent", "important");
  }
  caja.setAttribute("data-escritura", "");

  // Ancestros que recortan (paneles con barra de desplazamiento): la capa se recorta igual.
  const recortes: HTMLElement[] = [];
  for (let nodo = caja.parentElement; nodo && nodo !== document.documentElement; nodo = nodo.parentElement) {
    const cs = getComputedStyle(nodo);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") recortes.push(nodo);
  }

  let texto = caja.value;
  let nacidas = nacimientos("", texto, [], Number.NEGATIVE_INFINITY);
  let ultimoPunto: Punto | null = null;
  let firma = "";
  let tamano = "";
  let estiloActual = "";
  let seleccion = "";
  let cuadros = 0;
  let tecleo = 0;
  let cuadro = 0;
  let izquierda = 0;
  let arriba = 0;

  function sincronizar(capa: HTMLElement): void {
    const cs = getComputedStyle(caja);
    for (const nombre of PROPIEDADES) capa.style.setProperty(nombre, cs.getPropertyValue(nombre));
    const bordeIzq = Number.parseFloat(cs.borderLeftWidth);
    const bordeDer = Number.parseFloat(cs.borderRightWidth);
    const margenDer = Number.parseFloat(cs.paddingRight);
    const margenIzq = Number.parseFloat(cs.paddingLeft);
    // Con barra de desplazamiento el texto tiene menos ancho: se suma al margen derecho.
    const barra = Math.max(0, Math.round(caja.offsetWidth - caja.clientWidth - bordeIzq - bordeDer));
    // Medidas exactas (con fracción de pixel): un cuarto de pixel menos cambia dónde corta el renglón.
    const medidas = caja.getBoundingClientRect();
    estilo(capa, {
      position: "absolute",
      display: "block",
      left: "0px",
      top: "0px",
      margin: "0",
      "box-sizing": "border-box",
      width: px(medidas.width),
      height: px(medidas.height),
      "border-style": "solid",
      "border-color": "transparent",
      "padding-right": px(margenDer + barra),
      overflow: "hidden",
      background: "transparent",
      "pointer-events": "none",
    });
    if (unRenglon) {
      // Una caja de un renglón centra el texto a lo alto y lo recorta en su margen interno.
      const margenArriba = Number.parseFloat(cs.paddingTop);
      const altoUtil = caja.clientHeight - margenArriba - Number.parseFloat(cs.paddingBottom);
      const renglon = renglonDeCajaUnica(cs.lineHeight, altoUtil);
      const prueba = document.createElement("span");
      for (const nombre of PROPIEDADES) prueba.style.setProperty(nombre, cs.getPropertyValue(nombre));
      estilo(prueba, { position: "absolute", display: "block", visibility: "hidden", padding: "0", border: "0", "white-space": "pre", "line-height": renglon });
      prueba.textContent = "Mg";
      raiz.appendChild(prueba);
      const altoRenglon = prueba.getBoundingClientRect().height;
      prueba.remove();
      const reserva = reservaDeLaEquis(caja);
      estilo(capa, {
        "white-space": "pre",
        "line-height": renglon,
        "padding-top": px(margenArriba + (altoUtil - altoRenglon) / 2),
        "padding-bottom": "0px",
        "padding-right": px(margenDer + barra + reserva),
        "clip-path": `inset(0 ${px(margenDer + bordeDer + reserva)} 0 ${px(margenIzq + bordeIzq)})`,
      });
    } else {
      estilo(capa, {
        "white-space": cs.whiteSpace,
        "overflow-wrap": cs.overflowWrap,
        "word-break": cs.wordBreak,
      });
    }
  }

  function desplazar(capa: HTMLElement): void {
    if (unRenglon) capa.scrollLeft = caja.scrollLeft;
    else capa.scrollTop = caja.scrollTop;
  }

  function colocarRaiz(): void {
    const deCaja = caja.getBoundingClientRect();
    const deRaiz = raiz.getBoundingClientRect();
    const dx = deCaja.left - deRaiz.left;
    const dy = deCaja.top - deRaiz.top;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      izquierda += dx;
      arriba += dy;
      raiz.style.setProperty("left", px(izquierda));
      raiz.style.setProperty("top", px(arriba));
    }
    raiz.style.setProperty("width", px(deCaja.width));
    raiz.style.setProperty("height", px(deCaja.height));
    // Recorte de los paneles de alrededor, en coordenadas de la caja.
    let l = Number.NEGATIVE_INFINITY;
    let t = Number.NEGATIVE_INFINITY;
    let r = Number.POSITIVE_INFINITY;
    let b = Number.POSITIVE_INFINITY;
    for (const nodo of recortes) {
      const caj = nodo.getBoundingClientRect();
      l = Math.max(l, caj.left + nodo.clientLeft);
      t = Math.max(t, caj.top + nodo.clientTop);
      r = Math.min(r, caj.left + nodo.clientLeft + nodo.clientWidth);
      b = Math.min(b, caj.top + nodo.clientTop + nodo.clientHeight);
    }
    const arribaCorte = Math.max(0, t - deCaja.top);
    const izqCorte = Math.max(0, l - deCaja.left);
    const derCorte = Math.max(0, deCaja.right - r);
    const abajoCorte = Math.max(0, deCaja.bottom - b);
    raiz.style.setProperty(
      "clip-path",
      arribaCorte || izqCorte || derCorte || abajoCorte
        ? `inset(${px(arribaCorte)} ${px(derCorte)} ${px(abajoCorte)} ${px(izqCorte)})`
        : "none",
    );
  }

  function pintarLetras(): void {
    const ahora = performance.now();
    const nuevo = caja.value;
    if (nuevo !== texto) {
      nacidas = nacimientos(texto, nuevo, nacidas, ahora);
      texto = nuevo;
    }
    letras.textContent = "";
    for (const tramo of tramos(texto, nacidas, ahora)) {
      if (tramo.edad === null) {
        letras.appendChild(document.createTextNode(tramo.texto));
      } else {
        const letra = document.createElement("span");
        letra.className = "escritura-letra";
        letra.style.setProperty("animation-delay", `${-tramo.edad}ms`);
        letra.textContent = tramo.texto;
        letras.appendChild(letra);
      }
    }
    desplazar(letras);
  }

  function colocarCursor(): void {
    const inicio = caja.selectionStart;
    const fin = caja.selectionEnd;
    if (inicio === null || fin === null || inicio !== fin || !document.hasFocus()) {
      cursor.hidden = true;
      ultimoPunto = null;
      return;
    }
    medida.textContent = "";
    const marca = document.createElement("span");
    marca.textContent = texto.slice(fin) || ".";
    medida.append(document.createTextNode(texto.slice(0, fin)), marca);
    desplazar(medida);
    const lugar = marca.getClientRects()[0] ?? marca.getBoundingClientRect();
    const origen = raiz.getBoundingClientRect();
    const punto = { x: Math.round(lugar.left - origen.left), y: Math.round(lugar.top - origen.top) };
    const alto = Math.round(lugar.height);
    // Fuera de la parte visible de la caja (texto desplazado) el cursor no se ve, como el real.
    const visible =
      punto.y + alto > caja.clientTop &&
      punto.y < caja.clientTop + caja.clientHeight &&
      punto.x >= caja.clientLeft - 1 &&
      punto.x <= caja.clientLeft + caja.clientWidth;
    cursor.hidden = !visible;
    cursor.style.setProperty("transition-duration", `${esSalto(ultimoPunto, punto) ? DESLIZ_MS : 0}ms`);
    cursor.style.setProperty("height", px(alto));
    cursor.style.setProperty("transform", `translate(${px(punto.x)}, ${px(punto.y)})`);
    ultimoPunto = punto;
  }

  function teclear(): void {
    cursor.setAttribute("data-tecleando", "");
    window.clearTimeout(tecleo);
    tecleo = window.setTimeout(() => cursor.removeAttribute("data-tecleando"), TECLEO_MS);
  }

  function firmaDeEstilo(): string {
    const cs = getComputedStyle(caja);
    return [cs.color, cs.font, cs.lineHeight, cs.padding, cs.borderWidth, cs.letterSpacing, cs.textAlign].join("|");
  }

  /** Revisa la caja y redibuja solo lo que cambió. */
  function revisar(forzar: boolean): void {
    const deCaja = caja.getBoundingClientRect();
    const nuevaFirma = [deCaja.left, deCaja.top, caja.scrollTop, caja.scrollLeft].join(",");
    const nuevoTamano = [deCaja.width, deCaja.height, caja.clientWidth, caja.clientHeight].join(",");
    // Cada ~½ s se revisa si cambió el estilo (tema claro/oscuro, por ejemplo).
    let restilar = forzar || nuevoTamano !== tamano;
    if (!restilar && ++cuadros % 30 === 0) restilar = firmaDeEstilo() !== estiloActual;
    if (restilar) {
      estiloActual = firmaDeEstilo();
      tamano = nuevoTamano;
      sincronizar(medida);
      sincronizar(letras);
    }
    const cambioLugar = restilar || nuevaFirma !== firma;
    if (cambioLugar) {
      firma = nuevaFirma;
      colocarRaiz();
    }
    const cambioTexto = caja.value !== texto;
    if (forzar || cambioTexto) pintarLetras();
    else if (cambioLugar) desplazar(letras);
    const nuevaSeleccion = `${caja.selectionStart},${caja.selectionEnd},${document.hasFocus()}`;
    if (forzar || cambioTexto || cambioLugar || nuevaSeleccion !== seleccion) {
      seleccion = nuevaSeleccion;
      colocarCursor();
    }
  }

  function vigilar(): void {
    if (!caja.isConnected || document.activeElement !== caja || !animable(caja) || autollenada(caja)) {
      soltar();
      return;
    }
    revisar(false);
    cuadro = window.requestAnimationFrame(vigilar);
  }

  const alEscribir = (): void => {
    teclear();
    revisar(false);
  };
  caja.addEventListener("input", alEscribir);
  caja.addEventListener("keydown", teclear);

  let suelta = false;
  function soltar(): void {
    if (suelta) return;
    suelta = true;
    window.cancelAnimationFrame(cuadro);
    window.clearTimeout(tecleo);
    caja.removeEventListener("input", alEscribir);
    caja.removeEventListener("keydown", teclear);
    raiz.remove();
    caja.removeAttribute("data-escritura");
    for (const [nombre, previo] of previos) {
      if (previo.valor) caja.style.setProperty(nombre, previo.valor, previo.prioridad);
      else caja.style.removeProperty(nombre);
    }
  }

  revisar(true);
  cuadro = window.requestAnimationFrame(vigilar);
  return soltar;
}

/** Se instala una vez, desde instrumentation-client.ts. */
export function animarEscritura(): void {
  if (typeof window === "undefined" || window.__crmEscritura) return;
  window.__crmEscritura = true;
  let soltar: (() => void) | null = null;
  document.addEventListener("focusin", (evento) => {
    soltar?.();
    soltar = null;
    const caja = evento.target;
    if (!esCaja(caja) || !animable(caja) || autollenada(caja) || caja.selectionStart === null || !cumpleElEquipo()) return;
    soltar = adjuntar(caja);
  });
  document.addEventListener("focusout", (evento) => {
    if (evento.target !== null && esCaja(evento.target)) {
      soltar?.();
      soltar = null;
    }
  });
}
