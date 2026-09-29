// Cambios en vivo del Embudo (contact.updated): cómo entra un contacto recién
// leído del servidor a la lista del tablero. PURO (sin React).
// - Si cambió de etapa (o volvió a entrar a la misma), sube arriba de su nueva
//   columna, como cuando se mueve a mano: la lista va por stageChangedAt de más
//   nuevo a más viejo (listContacts) y se inserta en su lugar por esa hora.
// - Si no (temperatura, nombre…), se reemplaza en su lugar, sin reordenar.
// - Uno que el tablero no tenía (se perdió su contact.created) entra igual.
// Las columnas salen de agrupar esta lista por etapa y ordenar cada una por
// actividad (columnsByStage, abajo).
type LiveContact = { id: string; stage: string; stageChangedAt: Date | string };

function time(value: Date | string): number {
  return new Date(value).getTime();
}

type SortableContact = {
  id: string;
  stage: string;
  stageChangedAt: Date | string;
  createdAt: Date | string;
  lastInboundAt: number | null;
};

/**
 * Hora que ordena la tarjeta en su columna (regla del dueño, 28-sep-2026): lo más
 * reciente entre que entró a la etapa (a mano, por el Agente IA o al crearse) y el
 * último mensaje del CLIENTE. `live` = la hora que trajo la señal en vivo (SSE), que
 * puede ser más nueva que la de la carga. Un mensaje nuestro no la mueve.
 */
export function boardActivityAt(contact: SortableContact, live?: number | null): number {
  return Math.max(time(contact.stageChangedAt), contact.lastInboundAt ?? 0, live ?? 0);
}

/**
 * Columnas del tablero: cada etapa con sus contactos de más reciente a más viejo por
 * actividad (empate: el contacto más nuevo, luego el id, para que no brinquen). Las
 * etapas desconocidas se omiten. `liveInbound(id)` = hora del último entrante en vivo.
 */
export function columnsByStage<T extends SortableContact>(
  contacts: readonly T[],
  stageKeys: readonly string[],
  liveInbound: (contactId: string) => number | null | undefined,
): Map<string, T[]> {
  const columns = new Map<string, { contact: T; at: number; created: number }[]>(stageKeys.map((key) => [key, []]));
  for (const contact of contacts) {
    columns.get(contact.stage)?.push({ contact, at: boardActivityAt(contact, liveInbound(contact.id)), created: time(contact.createdAt) });
  }
  const out = new Map<string, T[]>();
  for (const [key, list] of columns) {
    list.sort((a, b) => b.at - a.at || b.created - a.created || (a.contact.id < b.contact.id ? -1 : a.contact.id > b.contact.id ? 1 : 0));
    out.set(key, list.map((entry) => entry.contact));
  }
  return out;
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

/**
 * Temperatura y Destacado de la puesta al día (ninguno lleva hora: se comparan completos).
 * `pairs` = id → temperatura de TODOS los que tienen una (sin par = sin temperatura);
 * `destacados` = ids de TODOS los Destacado (sin id = no destacado). Cambia solo las
 * tarjetas distintas, sin reordenar; `skip` = contactos que no se tocan ahora (escritura
 * propia en curso o tarjeta en arrastre). Devuelve la misma lista si nada cambió.
 */
export function applyMarks<T extends { id: string; temperature: string | null; destacado: boolean }>(
  current: readonly T[],
  pairs: readonly (readonly [string, string])[],
  destacados: readonly string[],
  skip: ReadonlySet<string>,
): T[] {
  const byId = new Map(pairs);
  const marked = new Set(destacados);
  let changed = false;
  const next = current.map((contact) => {
    if (skip.has(contact.id)) return contact;
    const temperature = byId.get(contact.id) ?? null;
    const destacado = marked.has(contact.id);
    if (contact.temperature === temperature && contact.destacado === destacado) return contact;
    changed = true;
    return { ...contact, temperature, destacado };
  });
  return changed ? next : (current as T[]);
}
