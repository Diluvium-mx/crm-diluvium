// La columna de entrada (Inbox) llega por partes (lib/contacts/board-load.ts, auditoría de velocidad B4,
// 2-nov-2026). Reglas del tablero, PURAS (sin React):
// - El contador de la columna sigue diciendo el total: lo que se ve + los que faltan por cargar, mientras no
//   haya buscador, filtro, lupa ni «No leído» (con ellos solo cuenta lo que se ve, como las demás columnas).
// - Cuando llega un contacto que el tablero no tenía (al bajar, al buscar, por un aviso en vivo…), si ya existía
//   al cargar la página era de los que faltaban: «faltan» baja. Uno dado de alta después no (nunca se contó).
// - El texto para buscar de cada tarjeta se prepara una vez por contacto (no en cada tecla para todos).
import { normalizeSearch } from "@/lib/text/search";
import { getContactFullName, type BoardContact } from "../_data/types";

/** De `llegados`, cuántos no estaban en el tablero y ya existían al cargar la página. Los anota en `ids`. */
export function anotarLlegados(ids: Set<string>, llegados: readonly Pick<BoardContact, "id" | "createdAt">[], loadedAtMs: number): number {
  let faltaban = 0;
  for (const c of llegados) {
    if (ids.has(c.id)) continue;
    ids.add(c.id);
    if (new Date(c.createdAt).getTime() <= loadedAtMs) faltaban++;
  }
  return faltaban;
}

/** Cuántos suma el contador de la columna por lo que falta cargar (0 con buscador, filtros o «No leído»). */
export function faltanEnContador(restantes: number, sinFiltros: boolean): number {
  return sinFiltros ? Math.max(0, restantes) : 0;
}

/** Agrega al tablero los que no tenía (sin tocar los que ya estaban: pueden traer un cambio propio en curso). */
export function agregarNuevos(actuales: BoardContact[], llegados: readonly BoardContact[]): BoardContact[] {
  if (llegados.length === 0) return actuales;
  const tenidos = new Set(actuales.map((c) => c.id));
  const nuevos = llegados.filter((c) => !tenidos.has(c.id));
  return nuevos.length ? [...actuales, ...nuevos] : actuales;
}

const buscables = new WeakMap<BoardContact, { nombre: string; usuario: string }>();

/** Nombre y @usuario sin acentos ni mayúsculas, una vez por contacto (la tarjeta nueva es otro objeto). */
export function textoBuscable(contact: BoardContact): { nombre: string; usuario: string } {
  let texto = buscables.get(contact);
  if (!texto) {
    texto = { nombre: normalizeSearch(getContactFullName(contact)), usuario: normalizeSearch(contact.instagramUsername ?? "") };
    buscables.set(contact, texto);
  }
  return texto;
}
