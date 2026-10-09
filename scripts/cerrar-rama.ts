// Uso: npm run rama:cerrar -- <rama>            → cierra la rama que YA llegó a main
//      npm run rama:cerrar -- <rama> --probar   → solo dice qué haría
//
// Se corre desde la copia principal (en main) justo después de mezclar la rama a main y hacer push
// (docs/staging.md › Al llegar a main). En orden:
//   1. comprueba que TODO lo de la rama ya está en origin/main (si no, se detiene sin tocar nada);
//   2. pone la etiqueta `prod-AAAA-MM-DD-<rama>` en el commit con el que entró a main y la sube;
//   3. quita su worktree (solo si no tiene cambios sin guardar);
//   4. borra la rama en GitHub y en local.
// Volver a correrlo es seguro: reusa la etiqueta si ya existe y salta lo que ya no está.
import { execFileSync } from "node:child_process";
import { logError } from "@/lib/log/safe-error";
import { leerWorktrees, motivoParaNoCerrar, nombreEtiqueta } from "./lib/cerrar-rama";

const probar = process.argv.includes("--probar");
const rama = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function existe(ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function esAncestro(a: string, b: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", a, b]);
    return true;
  } catch {
    return false;
  }
}

function hacer(descripcion: string, args: string[]): void {
  console.info(`${probar ? "[probar] " : ""}${descripcion}`);
  if (!probar) git(args);
}

/** Commit de la línea principal de main con el que entró la rama (su merge, o la punta si fue fast-forward). */
function commitDeEntrada(punta: string): string {
  const primeraLinea = git(["rev-list", "--first-parent", "origin/main"]).split("\n");
  if (primeraLinea.includes(punta)) return punta;
  const candidatos = git(["rev-list", "--first-parent", "--reverse", "origin/main", "--not", punta]).split("\n");
  const entrada = candidatos.find((c) => c && esAncestro(punta, c));
  if (!entrada) throw new Error(`No encontré en main el commit con el que entró ${rama}.`);
  return entrada;
}

function main(): number {
  const motivo = motivoParaNoCerrar(rama, git(["rev-parse", "--abbrev-ref", "HEAD"]));
  if (motivo) {
    console.error(`[rama:cerrar] ${motivo}`);
    return 1;
  }
  git(["fetch", "--quiet", "--prune", "--tags", "origin"]);

  const remota = existe(`refs/remotes/origin/${rama}`) ? `refs/remotes/origin/${rama}` : null;
  const local = existe(`refs/heads/${rama}`) ? `refs/heads/${rama}` : null;
  const ref = remota ?? local;
  if (!ref) {
    console.error(`[rama:cerrar] ${rama} no existe ni en GitHub ni en local.`);
    return 1;
  }
  for (const ref of [remota, local]) {
    if (ref && !esAncestro(ref, "origin/main")) {
      console.error(`[rama:cerrar] ${ref} tiene commits que NO están en main; no se cierra (mézclala primero).`);
      return 1;
    }
  }

  // 1. Etiqueta del pase a producción.
  const punta = git(["rev-parse", ref]);
  const entrada = commitDeEntrada(punta);
  const yaEtiquetado = git(["tag", "--points-at", entrada, "--list", "prod-*"]).split("\n").filter(Boolean);
  if (yaEtiquetado.length > 0) {
    console.info(`Etiqueta ya puesta: ${yaEtiquetado.join(", ")}`);
  } else {
    const fecha = new Date(git(["show", "-s", "--format=%cI", entrada]));
    const etiqueta = nombreEtiqueta(rama, fecha, new Set(git(["tag", "--list", "prod-*"]).split("\n")));
    const asunto = git(["show", "-s", "--format=%s", entrada]);
    hacer(`Etiqueta ${etiqueta} → ${entrada.slice(0, 7)}`, ["tag", "-a", etiqueta, entrada, "-m", asunto]);
    hacer(`Subo la etiqueta a GitHub`, ["push", "--quiet", "origin", `refs/tags/${etiqueta}`]);
  }

  // 2. Worktree de la rama.
  const worktree = leerWorktrees(git(["worktree", "list", "--porcelain"])).find((w) => w.rama === rama);
  if (worktree) {
    if (git(["status", "--porcelain"], worktree.ruta) !== "") {
      console.error(`[rama:cerrar] El worktree ${worktree.ruta} tiene cambios sin guardar; revísalo y vuelve a correrlo.`);
      return 1;
    }
    hacer(`Quito el worktree ${worktree.ruta}`, ["worktree", "remove", worktree.ruta]);
  }

  // 3. La rama, en GitHub y en local (ya se comprobó arriba que todo está en main).
  if (remota) hacer(`Borro ${rama} en GitHub`, ["push", "--quiet", "origin", "--delete", rama]);
  if (local) hacer(`Borro ${rama} en local`, ["branch", "-D", rama]);
  console.info(probar ? "[rama:cerrar] Solo prueba: no se hizo nada." : `[rama:cerrar] ${rama} cerrada.`);
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  logError("[rama:cerrar]", error);
  process.exit(1);
}
