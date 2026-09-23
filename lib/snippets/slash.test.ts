import { describe, expect, it } from "vitest";
import { applySlashInsert, filterSnippets, findSlashQuery, normalizeForSearch } from "./slash";

describe("findSlashQuery", () => {
  it("abre al inicio del borrador y filtra con lo escrito", () => {
    expect(findSlashQuery("/pre", 4)).toEqual({ start: 0, end: 4, query: "pre" });
    expect(findSlashQuery("/", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("abre después de un espacio o salto de línea", () => {
    expect(findSlashQuery("Hola /env", 9)).toEqual({ start: 5, end: 9, query: "env" });
    expect(findSlashQuery("Hola\n/env", 9)).toEqual({ start: 5, end: 9, query: "env" });
  });

  it("no abre en URLs, fracciones ni con un salto entre el / y el cursor", () => {
    expect(findSlashQuery("https://diluvium.mx", 19)).toBeNull();
    expect(findSlashQuery("mide 1/2", 8)).toBeNull();
    expect(findSlashQuery("/pre\nhola", 9)).toBeNull();
    expect(findSlashQuery("sin barra", 9)).toBeNull();
  });

  it("usa la posición del cursor, no el final del texto", () => {
    expect(findSlashQuery("/pre y más", 4)).toEqual({ start: 0, end: 4, query: "pre" });
  });

  it("permite espacios en la búsqueda pero no más de 40 caracteres", () => {
    expect(findSlashQuery("/datos banc", 11)?.query).toBe("datos banc");
    const long = `/${"a".repeat(41)}`;
    expect(findSlashQuery(long, long.length)).toBeNull();
  });
});

describe("filterSnippets", () => {
  const snippets = [
    { name: "Saludo", body: "Hola, soy {{vendedor}} de Diluvium" },
    { name: "Envío a domicilio", body: "El envío tarda 3 días" },
    { name: "Precios", body: "Te comparto los precios" },
    { name: "Datos bancarios", body: "Cuenta para depósito" },
  ];

  it("sin búsqueda devuelve todos", () => {
    expect(filterSnippets(snippets, "").map((s) => s.name)).toEqual(snippets.map((s) => s.name));
  });

  it("ignora acentos y mayúsculas", () => {
    expect(filterSnippets(snippets, "ENVIO").map((s) => s.name)).toEqual(["Envío a domicilio"]);
    expect(normalizeForSearch("Envío")).toBe("envio");
  });

  it("prioriza nombre que empieza, luego nombre que contiene, luego cuerpo", () => {
    const list = [
      { name: "Hola precios", body: "" },
      { name: "Otro", body: "habla de precios" },
      { name: "Precios", body: "" },
    ];
    expect(filterSnippets(list, "precios").map((s) => s.name)).toEqual(["Precios", "Hola precios", "Otro"]);
  });

  it("respeta el límite", () => {
    expect(filterSnippets(snippets, "", 2)).toHaveLength(2);
  });
});

describe("applySlashInsert", () => {
  it("reemplaza /búsqueda por el fragmento y deja el cursor al final de lo insertado", () => {
    const text = "Hola /pre gracias";
    const slash = { start: 5, end: 9, query: "pre" };
    expect(applySlashInsert(text, slash, "Los precios son…")).toEqual({
      text: "Hola Los precios son… gracias",
      caret: 21,
    });
  });
});
