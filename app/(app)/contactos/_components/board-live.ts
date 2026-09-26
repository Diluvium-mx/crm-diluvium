// Cambios en vivo del Embudo (contact.updated): cómo entra un contacto recién
// leído del servidor a la lista del tablero. PURO (sin React).
// - Si cambió de etapa (o volvió a entrar a la misma), sube arriba de su nueva
//   columna, como cuando se mueve a mano: la lista va por stageChangedAt de más
//   nuevo a más viejo (listContacts) y se inserta en su lugar por esa hora.
// - Si no (temperatura, nombre…), se reemplaza en su lugar, sin reordenar.
// - Uno que el tablero no tenía (se perdió su contact.created) entra igual.
// Las columnas salen de filtrar esta lista por etapa: el orden y la
// virtualización siguen igual.
type LiveContact = { id: string; stage: string; stageChangedAt: Date | string };

function time(value: Date | string): number {
  return new Date(value).getTime();
}

export function mergeLiveContacts<T extends LiveContact>(current: readonly T[], fresh: readonly T[]): T[] {
  if (fresh.length === 0) return current as T[];
  const byId = new Map(fresh.map((c) => [c.id, c]));
  const next: T[] = [];
  const moved: T[] = [];
  const known = new Set<string>();
  for (const contact of current) {
    known.add(contact.id);
    const update = byId.get(contact.id);
    if (!update) next.push(contact);
    else if (update.stage !== contact.stage || time(update.stageChangedAt) > time(contact.stageChangedAt)) moved.push(update);
    else next.push(update);
  }
  for (const contact of fresh) if (!known.has(contact.id)) moved.push(contact);
  if (moved.length === 0) return next;
  // Cada uno va antes del primero que entró a su etapa a la misma hora o antes.
  for (const contact of moved.sort((a, b) => time(a.stageChangedAt) - time(b.stageChangedAt))) {
    const at = next.findIndex((c) => time(c.stageChangedAt) <= time(contact.stageChangedAt));
    next.splice(at === -1 ? next.length : at, 0, contact);
  }
  return next;
}
