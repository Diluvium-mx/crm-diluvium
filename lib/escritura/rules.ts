// Cursor y letras al escribir (2-oct-2026, decisión del dueño): reglas puras, sin DOM.
// Mientras el vendedor escribe en cualquier caja de texto del CRM, el cursor es azul de
// 2 px, parpadea suave, se queda fijo al teclear y se DESLIZA solo en los saltos; las
// letras nuevas entran con un desvanecido. Lo que dibuja la pantalla: ./client.ts.

/** Duración del desvanecido de cada letra nueva (la animación vive en globals.css). */
export const DURACION_LETRA_MS = 200;
/** Pasado esto la letra ya es texto normal (un poco más que la animación). */
export const VIGENCIA_LETRA_MS = 230;
/** Duración del deslizamiento del cursor en un salto. */
export const DESLIZ_MS = 130;
/** El cursor deja de parpadear al teclear y vuelve a hacerlo pasado este tiempo. */
export const TECLEO_MS = 530;

/** Saltos: cambio de renglón o más de esto de lado (una letra mide menos). */
const SALTO_LATERAL_PX = 14;
const SALTO_VERTICAL_PX = 2;

// Tipos de <input> que se animan (los buscadores del CRM son "search"). Fuera: contraseña
// (se ve con puntos), correo (el navegador no dice dónde está el cursor), número, fecha,
// hora y todo lo que no es texto.
const TIPOS_DE_TEXTO = new Set(["text", "search", "tel", "url"]);

export type Caja = { etiqueta: string; tipo: string; soloLectura: boolean; deshabilitada: boolean };

export function esCajaAnimable(caja: Caja): boolean {
  if (caja.soloLectura || caja.deshabilitada) return false;
  const etiqueta = caja.etiqueta.toLowerCase();
  if (etiqueta === "textarea") return true;
  return etiqueta === "input" && TIPOS_DE_TEXTO.has(caja.tipo.toLowerCase());
}

/**
 * Cuándo nació cada letra del texto nuevo. Lo que no cambió conserva su hora; lo que se
 * escribió, pegó o insertó en medio (lo que no está ni en el principio ni en el final en
 * común con el texto anterior) nace en `ahora`.
 */
export function nacimientos(antes: string, despues: string, previos: readonly number[], ahora: number): number[] {
  const base = previos.length === antes.length ? previos : antes.split("").map(() => Number.NEGATIVE_INFINITY);
  const tope = Math.min(antes.length, despues.length);
  let inicio = 0;
  while (inicio < tope && antes[inicio] === despues[inicio]) inicio++;
  let final = 0;
  while (final < tope - inicio && antes[antes.length - 1 - final] === despues[despues.length - 1 - final]) final++;
  const nuevas = despues.length - inicio - final;
  return [
    ...base.slice(0, inicio),
    ...Array.from({ length: nuevas }, () => ahora),
    ...base.slice(antes.length - final),
  ];
}

/** Pedazo del texto: `edad` null = letras ya asentadas; número = letras que aún entran. */
export type Tramo = { texto: string; edad: number | null };

/** Divide el texto en tramos asentados y tramos que aún se están desvaneciendo. */
export function tramos(texto: string, nacidas: readonly number[], ahora: number): Tramo[] {
  const salida: Tramo[] = [];
  let i = 0;
  while (i < texto.length) {
    const edad = ahora - (nacidas[i] ?? Number.NEGATIVE_INFINITY);
    let j = i + 1;
    if (edad >= VIGENCIA_LETRA_MS) {
      while (j < texto.length && ahora - (nacidas[j] ?? Number.NEGATIVE_INFINITY) >= VIGENCIA_LETRA_MS) j++;
      salida.push({ texto: texto.slice(i, j), edad: null });
    } else {
      while (j < texto.length && nacidas[j] === nacidas[i]) j++;
      salida.push({ texto: texto.slice(i, j), edad });
    }
    i = j;
  }
  return salida;
}

export type Punto = { x: number; y: number };

/**
 * ¿El cursor se desliza o va directo? Al teclear o borrar letra por letra va directo (si se
 * deslizara se quedaría letras atrás al escribir rápido); se desliza al cambiar de renglón o
 * al brincar lejos (clic, flechas ↑ ↓, pegar, Inicio/Fin).
 */
export function esSalto(antes: Punto | null, despues: Punto): boolean {
  if (!antes) return false;
  return Math.abs(despues.y - antes.y) > SALTO_VERTICAL_PX || Math.abs(despues.x - antes.x) > SALTO_LATERAL_PX;
}

/**
 * Alto de renglón con que el navegador centra el texto de una caja de UN renglón: si el
 * line-height no cabe en el alto útil de la caja, usa el normal de la letra (medido en
 * Chrome: con el line-height tal cual el texto quedaba 1 px más arriba que el real).
 */
export function renglonDeCajaUnica(lineHeight: string, altoUtil: number): string {
  if (lineHeight === "normal") return "normal";
  const alto = Number.parseFloat(lineHeight);
  if (!Number.isFinite(alto) || alto > altoUtil) return "normal";
  return lineHeight;
}
