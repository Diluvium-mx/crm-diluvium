import { describe, expect, it } from "vitest";
import { highlightParts, searchRanges, snippetAround } from "./highlight";
import { chatSearchTerm } from "./search";

describe("searchRanges", () => {
  it("encuentra la palabra sin acentos, ñ ni mayúsculas y regresa posiciones del texto original", () => {
    const text = "¿Hacen instalación en Culiacán?";
    const [range] = searchRanges(text, chatSearchTerm("culiacan")!);
    expect(text.slice(range[0], range[1])).toBe("Culiacán");
    const [other] = searchRanges("Soy de PEÑASCO", chatSearchTerm("peñas")!);
    expect("Soy de PEÑASCO".slice(other[0], other[1])).toBe("PEÑAS");
  });

  it("todas las coincidencias, sin empalmes, también dentro de otra palabra", () => {
    const text = "Factura: le facturamos hoy la factura";
    expect(searchRanges(text, "factura").map(([a, b]) => text.slice(a, b))).toEqual(["Factura", "factura", "factura"]);
    expect(searchRanges("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("sin término o sin coincidencias: nada", () => {
    expect(searchRanges("hola", "")).toEqual([]);
    expect(searchRanges("", "hola")).toEqual([]);
    expect(searchRanges("hola", "adios")).toEqual([]);
  });

  it("los emojis no corren las posiciones", () => {
    const text = "👍 Ya hice el depósito 🙏";
    const [range] = searchRanges(text, "deposito");
    expect(text.slice(range[0], range[1])).toBe("depósito");
  });
});

describe("highlightParts", () => {
  it("parte el texto en normales y coincidencias, sin perder nada", () => {
    const parts = highlightParts("¿Me pueden dar factura?", "factura");
    expect(parts).toEqual([
      { text: "¿Me pueden dar ", hit: false },
      { text: "factura", hit: true },
      { text: "?", hit: false },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("¿Me pueden dar factura?");
  });

  it("sin término: el texto completo, sin resaltar", () => {
    expect(highlightParts("hola", null)).toEqual([{ text: "hola", hit: false }]);
  });
});

describe("snippetAround", () => {
  it("si la palabra está cerca del inicio, el texto completo en una línea", () => {
    expect(snippetAround("Ya les\nmandé la factura", "factura", 24)).toBe("Ya les mandé la factura");
    expect(snippetAround("Mandé la factura", "factura", 12)).toBe("Mandé la factura");
  });

  it("si está lejos, recorta antes con … y sin partir palabras", () => {
    const text = "Buenas tardes, le escribo porque necesito que me manden la factura del anticipo";
    const snippet = snippetAround(text, "factura", 20);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet).toContain("factura del anticipo");
    expect(snippet.slice(1).split(" ")[0]).not.toBe("");
    expect(text).toContain(snippet.slice(1));
  });
});
