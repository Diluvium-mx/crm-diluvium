// Orden manual de los mensajes rápidos (26-oct-2026, columna `snippets.position`). PURO y seguro para el
// cliente: un orden nuevo solo vale si trae exactamente los de la organización (ni falta ni sobra ni se
// repite uno). El lugar de uno nuevo (al final) lo da ./next-position.ts dentro del INSERT.

/** ¿`next` es un orden completo de `current`? (mismos ids, sin faltar, sobrar ni repetir). */
export function isFullOrder(current: readonly string[], next: readonly string[]): boolean {
  if (next.length !== current.length || new Set(next).size !== next.length) return false;
  const ids = new Set(current);
  return next.every((id) => ids.has(id));
}

/** Mueve el elemento de `from` a `to` (índices de la lista completa); fuera de rango, la deja igual. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
