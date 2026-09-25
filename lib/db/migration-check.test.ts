import { describe, expect, it } from "vitest";
import { compareMigrations, describeReport } from "./migration-check";

const J = [
  { idx: 0, tag: "0026_a", when: 100 },
  { idx: 1, tag: "0027_automatizacion", when: 200 },
  { idx: 2, tag: "0030_anuncios_meta", when: 300 },
];

describe("candado de migraciones", () => {
  it("todas aplicadas → ok", () => {
    const r = compareMigrations(J, [100, 200, 300].map((createdAt) => ({ createdAt, hash: "" })));
    expect(r.ok).toBe(true);
    expect(describeReport(r)).toMatch(/al día/);
  });

  it("0030 aplicada y 0027 faltante (drizzle la saltó por `when` menor) → falla y la nombra", () => {
    const r = compareMigrations(J, [100, 300].map((createdAt) => ({ createdAt, hash: "" })));
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.tag)).toEqual(["0027_automatizacion"]);
    expect(describeReport(r)).toMatch(/FALTAN 1 migración\(es\).*0027_automatizacion/);
  });

  it("una migración aplicada con otro .sql se avisa (no bloquea); una fila fuera del journal, también", () => {
    const hashes = new Map([["0026_a", "h1"], ["0027_automatizacion", "h2"], ["0030_anuncios_meta", "h3"]]);
    const r = compareMigrations(
      J,
      [
        { createdAt: 100, hash: "h1" },
        { createdAt: 200, hash: "OTRO" },
        { createdAt: 300, hash: "h3" },
        { createdAt: 250, hash: "vieja" },
      ],
      hashes,
    );
    expect(r.ok).toBe(true);
    expect(r.changed.map((c) => c.tag)).toEqual(["0027_automatizacion"]);
    expect(r.unknown.map((u) => u.createdAt)).toEqual([250]);
  });
});
