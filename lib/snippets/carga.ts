// Plan de carga de mensajes rápidos (snippets) por NOMBRE, para el script
// `npm run mensajes-rapidos:cargar`. Lógica pura (sin base de datos), para
// testearla sola: decide qué se crea, qué se actualiza y qué queda igual.
// Los mensajes rápidos de la organización que no están en la lista NO se tocan
// ni se borran nunca (quedan en `untouched`).
import { normalizeForSearch } from "./slash";
import { SNIPPET_BODY_MAX, SNIPPET_NAME_MAX } from "./limits";
import { extractVariables } from "./variables";

export type DesiredSnippet = {
  name: string;
  body: string;
  /**
   * Nombres con los que ya puede existir (p. ej. "Buenas tardes" antes de
   * llevar emoji). Si no hay uno con `name`, se actualiza ese (nombre y texto)
   * en vez de crear otro.
   */
  previousNames?: string[];
};

export type ExistingSnippet = { id: string; name: string; body: string };

export type SnippetUpdate = {
  id: string;
  from: { name: string; body: string };
  to: { name: string; body: string };
};

export type SnippetLoadPlan = {
  create: { name: string; body: string }[];
  update: SnippetUpdate[];
  unchanged: ExistingSnippet[];
  /** Los demás de la organización: no se tocan. */
  untouched: ExistingSnippet[];
  /**
   * De los que no se tocan, los que se parecen a uno de la lista (mismo nombre
   * sin acentos ni mayúsculas): solo se avisan, para revisarlos a mano.
   */
  similar: { existing: ExistingSnippet; desiredName: string }[];
};

// Igualdad de nombres a prueba de espacios sobrantes y de acentos compuestos de
// otra forma (NFC/NFD), pero SENSIBLE a mayúsculas y acentos: "precio" no es
// "Precio" (para eso está `similar`).
function nameKey(name: string): string {
  return name.normalize("NFC").trim();
}

/** Revisa la lista antes de planear: nombres únicos, sin variables y dentro de los topes. */
export function validateDesired(desired: DesiredSnippet[]): void {
  const seen = new Set<string>();
  for (const item of desired) {
    const key = nameKey(item.name);
    if (!key) throw new Error("Hay un mensaje rápido sin nombre en la lista.");
    if (item.name !== key) throw new Error(`"${item.name}": el nombre no puede llevar espacios al inicio o al final.`);
    if (key.length > SNIPPET_NAME_MAX) throw new Error(`"${key}": el nombre pasa de ${SNIPPET_NAME_MAX} caracteres.`);
    if (!item.body.trim()) throw new Error(`"${key}": el mensaje está vacío.`);
    if (item.body !== item.body.trim()) throw new Error(`"${key}": el mensaje no puede empezar ni terminar con espacios.`);
    if (item.body.length > SNIPPET_BODY_MAX) throw new Error(`"${key}": el mensaje pasa de ${SNIPPET_BODY_MAX} caracteres.`);
    if (extractVariables(item.body).length > 0) throw new Error(`"${key}": la lista no lleva variables {{…}}.`);
    if (seen.has(key)) throw new Error(`"${key}" está repetido en la lista.`);
    seen.add(key);
  }
  for (const item of desired) {
    for (const previous of item.previousNames ?? []) {
      if (seen.has(nameKey(previous))) {
        throw new Error(`"${previous}" es nombre anterior de "${item.name}" y también está en la lista.`);
      }
    }
  }
}

export function planSnippetLoad(existing: ExistingSnippet[], desired: DesiredSnippet[]): SnippetLoadPlan {
  validateDesired(desired);
  const claimed = new Set<string>();

  // Primero el nombre EXACTO; si no hay, el mismo nombre con espacios sobrantes
  // o acentos compuestos distinto (si hay más de uno así, no se adivina).
  function find(name: string): ExistingSnippet | undefined {
    const free = existing.filter((row) => !claimed.has(row.id));
    const exact = free.find((row) => row.name === name);
    if (exact) return exact;
    const sameKey = free.filter((row) => nameKey(row.name) === nameKey(name));
    if (sameKey.length > 1) {
      throw new Error(`Hay ${sameKey.length} mensajes rápidos que se llaman "${nameKey(name)}" (con espacios distintos): revisar a mano.`);
    }
    return sameKey[0];
  }

  const plan: SnippetLoadPlan = { create: [], update: [], unchanged: [], untouched: [], similar: [] };
  // Dos pasadas: primero todos los nombres actuales y después los anteriores,
  // para que un nombre anterior nunca le gane la fila a un nombre actual.
  const matched = new Map<DesiredSnippet, ExistingSnippet>();
  for (const item of desired) {
    const row = find(item.name);
    if (row) {
      claimed.add(row.id);
      matched.set(item, row);
    }
  }
  for (const item of desired) {
    if (matched.has(item)) continue;
    for (const previous of item.previousNames ?? []) {
      const row = find(previous);
      if (row) {
        claimed.add(row.id);
        matched.set(item, row);
        break;
      }
    }
  }

  for (const item of desired) {
    const row = matched.get(item);
    if (!row) {
      plan.create.push({ name: item.name, body: item.body });
    } else if (row.name === item.name && row.body === item.body) {
      plan.unchanged.push(row);
    } else {
      plan.update.push({ id: row.id, from: { name: row.name, body: row.body }, to: { name: item.name, body: item.body } });
    }
  }

  plan.untouched = existing.filter((row) => !claimed.has(row.id));
  for (const row of plan.untouched) {
    const folded = normalizeForSearch(row.name);
    const twin = desired.find(
      (item) =>
        normalizeForSearch(item.name) === folded || (item.previousNames ?? []).some((previous) => normalizeForSearch(previous) === folded),
    );
    if (twin) plan.similar.push({ existing: row, desiredName: twin.name });
  }
  return plan;
}

/**
 * ¿Quedó la organización como pide la lista? Cada mensaje de la lista existe
 * UNA vez con su texto exacto, y los que no se debían tocar siguen idénticos.
 * Devuelve los problemas encontrados (vacío = todo bien).
 */
export function verifySnippetLoad(
  after: ExistingSnippet[],
  desired: DesiredSnippet[],
  untouchedBefore: ExistingSnippet[],
): string[] {
  const problems: string[] = [];
  for (const item of desired) {
    const rows = after.filter((row) => row.name === item.name);
    if (rows.length !== 1) problems.push(`"${item.name}": hay ${rows.length} con ese nombre (se esperaba 1).`);
    else if (rows[0].body !== item.body) problems.push(`"${item.name}": el texto no quedó igual a la lista.`);
  }
  for (const row of untouchedBefore) {
    const now = after.find((candidate) => candidate.id === row.id);
    if (!now) problems.push(`"${row.name}" desapareció (no se debía tocar).`);
    else if (now.name !== row.name || now.body !== row.body) problems.push(`"${row.name}" cambió (no se debía tocar).`);
  }
  return problems;
}
