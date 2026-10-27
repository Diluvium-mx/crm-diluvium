// Prueba GUARDIANA (27-oct-2026, pedido del dueño): ninguna pregunta del CRM usa la ventana del navegador
// (`window.confirm`, `alert(` o `prompt(`); se usa el aviso de arriba del CRM (components/ui/top-confirm.tsx) o una
// ventana propia (p. ej. app/(app)/contactos/_components/arco-dialog.tsx).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["app", "components"];
// Pendiente de OK del dueño (27-oct-2026): el aviso de error de «Agregar al diccionario» del corrector.
const ALLOW = new Set(["components/spelling/spellcheck-overlay.tsx"]);
const PATTERNS = [/\bwindow\.confirm\(/, /(?<![\w.])confirm\(\s*[`'"]/, /\bwindow\.alert\(/, /(?<![\w.])alert\(\s*[`'"]/, /\bwindow\.prompt\(/];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

describe("regla: avisos con el estilo del CRM, nunca la ventana del navegador", () => {
  it("ningún archivo de la app usa window.confirm, alert ni prompt", () => {
    const offenders: string[] = [];
    for (const dir of SCAN) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOW.has(rel)) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (!/^\s*\/\//.test(line) && PATTERNS.some((p) => p.test(line))) offenders.push(`${rel}:${i + 1}`);
          });
      }
    }
    expect(offenders, "usa TopConfirm (components/ui/top-confirm.tsx)").toEqual([]);
  });
});
