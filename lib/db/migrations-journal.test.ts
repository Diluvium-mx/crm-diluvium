// drizzle-orm aplica una migración solo si su `when` es MAYOR que el created_at
// de la última aplicada (node_modules/drizzle-orm/pg-core/dialect.js: `if
// (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)`):
// una con `when` menor se salta EN SILENCIO. Con ramas en paralelo (Fase B,
// Mejoras) es fácil que un merge deje una fuera de orden; esto truena antes.
//
// Numeración (docs/migraciones.md): `drizzle-kit generate` nombra la siguiente
// con `idx de la ÚLTIMA entrada + 1` (node_modules/drizzle-kit/bin.cjs, writeResult)
// y escribe `meta/<ese número>_snapshot.json`. Por eso el idx de cada entrada ES el
// número de su tag: la 0030 quedó vacía (se reservó para Anuncios, que entró como
// 0035) y, con el idx corrido, el siguiente generate pisaba un snapshot existente.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Journal = { entries: { idx: number; tag: string; when: number }[] };

const drizzleDir = new URL("../../drizzle/", import.meta.url);
const metaDir = new URL("meta/", drizzleDir);
const journal = JSON.parse(readFileSync(new URL("_journal.json", metaDir), "utf8")) as Journal;
const snapshots = readdirSync(metaDir)
  .filter((f) => f.endsWith("_snapshot.json"))
  .sort();

const numberOf = (tag: string) => Number(tag.slice(0, 4));
const prefix = (n: number) => String(n).padStart(4, "0");

describe("journal de migraciones de drizzle", () => {
  it("idx = número del tag, creciente y sin repetir (puede saltar: la 0030 quedó vacía)", () => {
    let prev = -1;
    for (const entry of journal.entries) {
      expect(entry.tag, `${entry.tag} no empieza con número`).toMatch(/^\d{4}_/);
      expect(entry.idx, `${entry.tag} tiene idx ${entry.idx}`).toBe(numberOf(entry.tag));
      expect(entry.idx, `${entry.tag} no va después de la anterior`).toBeGreaterThan(prev);
      prev = entry.idx;
    }
  });

  it("`when` estrictamente creciente (si no, drizzle se salta la migración)", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const [prev, cur] = [journal.entries[i - 1], journal.entries[i]];
      expect(cur.when, `${cur.tag} tiene when ≤ ${prev.tag}`).toBeGreaterThan(prev.when);
    }
  });

  it("cada entrada tiene su archivo .sql y no hay .sql fuera del journal", () => {
    for (const { tag } of journal.entries) {
      expect(existsSync(new URL(`${tag}.sql`, drizzleDir)), tag).toBe(true);
    }
    const tags = new Set(journal.entries.map((e) => `${e.tag}.sql`));
    const sqlFiles = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
    expect(sqlFiles.filter((f) => !tags.has(f))).toEqual([]);
  });

  it("la ÚLTIMA migración tiene su snapshot y es el último por nombre (el que drizzle-kit toma como base)", () => {
    const last = journal.entries.at(-1)!;
    expect(snapshots.at(-1)).toBe(`${prefix(last.idx)}_snapshot.json`);
  });

  it("el siguiente `drizzle-kit generate` no pisa ningún archivo ni snapshot", () => {
    const next = prefix(journal.entries.at(-1)!.idx + 1);
    expect(snapshots).not.toContain(`${next}_snapshot.json`);
    expect(journal.entries.some((e) => e.tag.startsWith(`${next}_`))).toBe(false);
    expect(readdirSync(drizzleDir).some((f) => f.startsWith(`${next}_`))).toBe(false);
  });

  it("cadena de snapshots lineal (prevId único; si no, drizzle-kit aborta por 'collision')", () => {
    const prevIds = snapshots.map((f) => (JSON.parse(readFileSync(new URL(f, metaDir), "utf8")) as { prevId: string }).prevId);
    expect(new Set(prevIds).size).toBe(prevIds.length);
  });
});
