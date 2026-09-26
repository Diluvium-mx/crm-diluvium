import { describe, expect, it } from "vitest";
import { conversionOf, sortAndFilterRows, type AdRow } from "./ads-table";

const base: Omit<AdRow, "adKey" | "name" | "status" | "clients" | "bought"> = {
  adId: "1",
  thumbnailUrl: null,
  metaUrl: null,
  campaignName: "Lluvias",
  adsetName: "Culiacán",
  linkClicks: null,
};
const rows: AdRow[] = [
  { ...base, adKey: "a", name: "Compuerta", status: "active", clients: 10, bought: 2 },
  { ...base, adKey: "b", name: "Tapón", status: "paused", clients: 30, bought: 3 },
  { ...base, adKey: "c", name: "Mini compuerta", status: "unknown", clients: 20, bought: 0 },
];
const sort = { key: "clients" as const, dir: "desc" as const };

describe("tabla de anuncios (filtro, buscador, conversión)", () => {
  it("Activas esconde SOLO las pausadas: las de estado desconocido ('—') siguen a la vista", () => {
    expect(sortAndFilterRows(rows, { query: "", onlyActive: true, sort }).map((r) => r.adKey)).toEqual(["c", "a"]);
    expect(sortAndFilterRows(rows, { query: "", onlyActive: false, sort }).map((r) => r.adKey)).toEqual(["b", "c", "a"]);
  });

  it("buscador sin acentos ni mayúsculas (lib/text/search.ts)", () => {
    expect(sortAndFilterRows(rows, { query: "TAPON", onlyActive: false, sort }).map((r) => r.adKey)).toEqual(["b"]);
    expect(sortAndFilterRows(rows, { query: "culiacan", onlyActive: false, sort })).toHaveLength(3);
  });

  it("conversión = compraron ÷ clientes; sin clientes → null ('—')", () => {
    expect(conversionOf(rows[0])).toBe(0.2);
    expect(conversionOf({ ...rows[0], clients: 0, bought: 0 })).toBeNull();
  });
});
