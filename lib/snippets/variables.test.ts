import { describe, expect, it } from "vitest";
import { extractVariables, renderSnippet } from "./variables";

describe("extractVariables", () => {
  it("saca las variables en orden de aparición, sin repetir", () => {
    expect(extractVariables("Hola {{nombre}}, tu pedido {{folio}} va para {{ciudad}}.")).toEqual([
      "nombre",
      "folio",
      "ciudad",
    ]);
    expect(extractVariables("{{nombre}} {{nombre}} otra vez {{nombre}}")).toEqual(["nombre"]);
  });

  it("tolera espacios internos y acentos en el nombre", () => {
    expect(extractVariables("Su {{ teléfono }} y {{ razon social }}")).toEqual([
      "teléfono",
      "razon social",
    ]);
  });

  it("ignora tokens vacíos o con nombre inválido", () => {
    expect(extractVariables("nada {{}} ni {{ }} ni {{con\nsalto}}")).toEqual([]);
    expect(extractVariables("texto sin variables")).toEqual([]);
  });
});

describe("renderSnippet", () => {
  it("rellena por nombre y deja intactas las que no tienen valor", () => {
    const body = "Hola {{nombre}}, tu pedido {{folio}} está listo.";
    expect(renderSnippet(body, { nombre: "Ana" })).toBe(
      "Hola Ana, tu pedido {{folio}} está listo.",
    );
    expect(renderSnippet(body, { nombre: "Ana", folio: "ORD-7" })).toBe(
      "Hola Ana, tu pedido ORD-7 está listo.",
    );
  });

  it("reemplaza todas las ocurrencias de la misma variable", () => {
    expect(renderSnippet("{{x}} y {{ x }} y {{x}}", { x: "1" })).toBe("1 y 1 y 1");
  });

  it("un valor vacío explícito sí borra el placeholder", () => {
    expect(renderSnippet("a{{v}}b", { v: "" })).toBe("ab");
  });
});
