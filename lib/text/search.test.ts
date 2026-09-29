import { describe, expect, it } from "vitest";
import { chatSearchTerm, escapeLike, matchesSearch, normalizeSearch, SQL_SEARCH_FROM, SQL_SEARCH_TO } from "./search";

describe("normalizeSearch", () => {
  it("quita acentos, ñ y mayúsculas", () => {
    expect(normalizeSearch("Ramón")).toBe("ramon");
    expect(normalizeSearch("PEÑA")).toBe("pena");
    expect(normalizeSearch("Instalación")).toBe("instalacion");
    expect(normalizeSearch("Müller")).toBe("muller");
  });

  it("recorta y junta espacios", () => {
    expect(normalizeSearch("  José   Luis  ")).toBe("jose luis");
  });
});

describe("matchesSearch", () => {
  it("ignora acentos en ambos lados", () => {
    expect(matchesSearch("Ramón Peña", "ramon")).toBe(true);
    expect(matchesSearch("Ramon Pena", "ramón")).toBe(true);
    expect(matchesSearch("Ramón Peña", "PENA")).toBe(true);
    expect(matchesSearch("¿Cuánto tarda la instalación?", "instalacion")).toBe(true);
    expect(matchesSearch("Ramón Peña", "ramón   peña")).toBe(true);
  });

  it("consulta vacía coincide con todo; texto ajeno no", () => {
    expect(matchesSearch("Ramón", "   ")).toBe(true);
    expect(matchesSearch("Ramón", "luis")).toBe(false);
  });
});

describe("tabla SQL", () => {
  it("las dos cadenas de translate() tienen el mismo largo y cubren mayúsculas y minúsculas", () => {
    expect([...SQL_SEARCH_FROM]).toHaveLength([...SQL_SEARCH_TO].length);
    for (const ch of ["ñ", "Ñ", "á", "Á", "ü", "Ü"]) expect(SQL_SEARCH_FROM).toContain(ch);
    // Cada letra acentuada se traduce a lo mismo que da normalizeSearch.
    [...SQL_SEARCH_FROM].forEach((ch, i) => {
      expect(normalizeSearch(ch)).toBe([...SQL_SEARCH_TO][i]);
    });
  });
});

describe("chatSearchTerm (búsqueda dentro de los chats)", () => {
  it("normaliza como todo buscador y pide al menos 3 letras", () => {
    expect(chatSearchTerm("  Culiacán ")).toBe("culiacan");
    expect(chatSearchTerm("PEÑA")).toBe("pena");
    expect(chatSearchTerm("de")).toBeNull();
    expect(chatSearchTerm("  a  b ")).toBe("a b");
    expect(chatSearchTerm("")).toBeNull();
    expect(chatSearchTerm(null)).toBeNull();
  });

  it("recorta a 100 letras", () => {
    expect(chatSearchTerm("x".repeat(150))).toHaveLength(100);
  });
});

describe("escapeLike", () => {
  it("escapa comodines de LIKE y la diagonal invertida", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
    expect(escapeLike("factura")).toBe("factura");
  });
});
