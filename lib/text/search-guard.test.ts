// Prueba GUARDIANA de la regla "todo buscador ignora acentos" (CLAUDE.md §6):
// falla si algún archivo de la app filtra con `.toLowerCase().includes(` o con
// `ilike(` directo en vez de lib/text/search.ts. Excepciones explícitas abajo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["app", "lib", "components"];
// Fase D es dueña del filtro de comandos del composer: no se toca desde aquí
// (anotado en el reporte del pulido UI para que Fase D lo pase a la regla).
const ALLOW = new Set(["app/(app)/dashboard/_components/composer.tsx"]);
const PATTERNS = [/\.toLowerCase\(\)\.includes\(/, /\.toLocaleLowerCase\(\)\.includes\(/, /\bilike\(/];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

describe("regla: buscadores sin acentos (lib/text/search.ts)", () => {
  it("ningún archivo filtra con toLowerCase().includes ni ilike directo", () => {
    const offenders: string[] = [];
    for (const dir of SCAN) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOW.has(rel) || rel.startsWith("lib/text/")) continue;
        const src = readFileSync(file, "utf8");
        src.split("\n").forEach((line, i) => {
          if (PATTERNS.some((p) => p.test(line))) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(offenders, "usa matchesSearch/normalizeSearch de lib/text/search.ts").toEqual([]);
  });
});
