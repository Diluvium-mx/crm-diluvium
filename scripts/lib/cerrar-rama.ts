// Reglas puras de `npm run rama:cerrar` (scripts/cerrar-rama.ts): qué ramas se pueden cerrar y
// cómo se llama la etiqueta del pase a producción. Sin git aquí, para poder probarlas.

/** Ramas que nunca se cierran. */
export const RAMAS_PROTEGIDAS: ReadonlySet<string> = new Set(["main", "staging"]);

/** Fecha AAAA-MM-DD en hora de Mazatlán (la del negocio). */
export function fechaMazatlan(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mazatlan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

/** `fix/aviso-luz-unida` → `aviso-luz-unida`; sin prefijo se queda igual; solo [a-z0-9.-]. */
export function nombreCorto(rama: string): string {
  const partes = rama.split("/").filter(Boolean);
  const resto = partes.length > 1 ? partes.slice(1) : partes;
  return resto
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Etiqueta del pase a producción: `prod-AAAA-MM-DD-<rama sin prefijo>`. Si ya existe (la misma rama
 * entró dos veces el mismo día), le agrega `-2`, `-3`…
 */
export function nombreEtiqueta(rama: string, fecha: Date, existentes: ReadonlySet<string>): string {
  const base = `prod-${fechaMazatlan(fecha)}-${nombreCorto(rama) || "rama"}`;
  if (!existentes.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidata = `${base}-${n}`;
    if (!existentes.has(candidata)) return candidata;
  }
}

/** Motivo por el que una rama no se puede cerrar con el script, o null si se puede. */
export function motivoParaNoCerrar(rama: string, ramaActual: string): string | null {
  if (!rama.trim()) return "Falta el nombre de la rama: npm run rama:cerrar -- <rama>";
  if (RAMAS_PROTEGIDAS.has(rama)) return `«${rama}» nunca se cierra.`;
  if (rama === ramaActual) return `«${rama}» es la rama abierta en esta carpeta; cámbiate a main primero.`;
  return null;
}

export interface Worktree {
  ruta: string;
  rama: string | null;
}

/** Lee la salida de `git worktree list --porcelain`. */
export function leerWorktrees(porcelain: string): Worktree[] {
  const lista: Worktree[] = [];
  let actual: Worktree | null = null;
  for (const linea of porcelain.split("\n")) {
    if (linea.startsWith("worktree ")) {
      actual = { ruta: linea.slice("worktree ".length), rama: null };
      lista.push(actual);
    } else if (actual && linea.startsWith("branch refs/heads/")) {
      actual.rama = linea.slice("branch refs/heads/".length);
    }
  }
  return lista;
}
