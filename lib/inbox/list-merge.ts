// Tiempo real de la lista de la bandeja (lógica pura, sin React ni base).
import type { ConversationListItem } from "./types";

/** Posición en la lista: último mensaje primero; empate por id (igual que el servidor). */
function sortKey(item: ConversationListItem): [number, string] {
  return [item.lastMessage ? new Date(item.lastMessage.at).getTime() : 0, item.id];
}

function before(a: ConversationListItem, b: ConversationListItem): boolean {
  const [ta, ia] = sortKey(a);
  const [tb, ib] = sortKey(b);
  return ta !== tb ? ta > tb : ia > ib;
}

/**
 * Aplica a la lista cargada las versiones frescas de `ids`: reemplaza, mueve
 * a su lugar, inserta las nuevas o quita las que ya no pasan el filtro. Si hay
 * más páginas sin cargar, una conversación que cae DESPUÉS de la última
 * cargada no se inserta (llegará con su página); así no se pierde el orden.
 */
export function mergeItems(
  list: ConversationListItem[],
  ids: string[],
  fresh: Map<string, ConversationListItem>,
  hasMore: boolean,
): ConversationListItem[] {
  const touched = new Set(ids);
  const rest = list.filter((c) => !touched.has(c.id));
  const last = rest.at(-1);
  for (const id of ids) {
    const item = fresh.get(id);
    if (!item) continue; // borrada o ya no pasa el filtro
    if (hasMore && last && before(last, item)) continue;
    const at = rest.findIndex((c) => before(item, c));
    rest.splice(at === -1 ? rest.length : at, 0, item);
  }
  return rest;
}

