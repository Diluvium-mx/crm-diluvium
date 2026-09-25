// drizzle-orm aplica una migración solo si su `when` es MAYOR que el created_at
// de la última aplicada (node_modules/drizzle-orm/pg-core/dialect.js: `if
// (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)`):
// una con `when` menor se salta EN SILENCIO. Con ramas en paralelo (Fase B,
// Mejoras) es fácil que un merge deje una fuera de orden; esto truena antes.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Journal = { entries: { idx: number; tag: string; when: number }[] };

const drizzleDir = new URL("../../drizzle/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", drizzleDir), "utf8")) as Journal;

describe("journal de migraciones de drizzle", () => {
  it("idx consecutivos; el número del tag nunca baja ni se repite (puede saltar: la 0030 quedó reservada para Anuncios de Meta)", () => {
    let last = -1;
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      const n = Number(entry.tag.slice(0, 4));
      expect(entry.tag, `${entry.tag} no empieza con número`).toMatch(/^\d{4}_/);
      expect(n, `${entry.tag} tiene número menor que su idx`).toBeGreaterThanOrEqual(i);
      expect(n, `${entry.tag} repite o baja el número`).toBeGreaterThan(last);
      last = n;
    });
  });

  it("`when` estrictamente creciente (si no, drizzle se salta la migración)", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const [prev, cur] = [journal.entries[i - 1], journal.entries[i]];
      expect(cur.when, `${cur.tag} tiene when ≤ ${prev.tag}`).toBeGreaterThan(prev.when);
    }
  });

  it("cada entrada tiene su archivo .sql", () => {
    for (const { tag } of journal.entries) {
      expect(existsSync(new URL(`${tag}.sql`, drizzleDir)), tag).toBe(true);
    }
  });
});
