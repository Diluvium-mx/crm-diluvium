// Prueba GUARDIANA (1-oct-2026): la conversión de fotos HEIC debe usar la
// variante `heic-to/csp`. Las otras (`heic-to`, `heic-to/next`) hacen 31
// `new Function` dentro de su Worker y la CSP no permite 'unsafe-eval'.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["app", "lib", "components"];
const IMPORT = /["']heic-to(\/[\w-]+)?["']/g;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

describe("regla: HEIC sin eval (heic-to/csp)", () => {
  it("solo se importa heic-to/csp", () => {
    const found: string[] = [];
    const offenders: string[] = [];
    for (const dir of SCAN) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
          found.push(rel);
          if (match[0].slice(1, -1) !== "heic-to/csp") offenders.push(`${rel}: ${match[0]}`);
        }
      }
    }
    expect(offenders, "usa import(\"heic-to/csp\")").toEqual([]);
    expect(found).toContain("lib/chat-attachments/convert.ts");
  });
});
