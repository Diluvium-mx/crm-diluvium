import { describe, expect, it } from "vitest";
import { renderTemplateBody, templateMaxIndex, templateVariablesFromBody } from "./template-format";

describe("templateMaxIndex", () => {
  it("toma el índice posicional más alto", () => {
    expect(templateMaxIndex("Hola {{1}}, tu pedido {{2}} llega el {{3}}.")).toBe(3);
    expect(templateMaxIndex("Sin variables")).toBe(0);
    expect(templateMaxIndex(null)).toBe(0);
  });

  it("con hueco toma el máximo, no la cantidad", () => {
    expect(templateMaxIndex("{{1}} y {{3}}")).toBe(3);
  });

  it("ignora {{nombre}} (eso es de Fragmentos, no de plantillas)", () => {
    expect(templateMaxIndex("Hola {{nombre}}")).toBe(0);
  });
});

describe("templateVariablesFromBody", () => {
  it("arma 1..N con su ejemplo cuando viene", () => {
    expect(templateVariablesFromBody("Hola {{1}}, folio {{2}}.", ["Ana", "ORD-7"])).toEqual([
      { index: 1, example: "Ana" },
      { index: 2, example: "ORD-7" },
    ]);
  });

  it("sin ejemplos deja solo el índice", () => {
    expect(templateVariablesFromBody("{{1}} {{2}}")).toEqual([{ index: 1 }, { index: 2 }]);
  });

  it("sin variables devuelve vacío", () => {
    expect(templateVariablesFromBody("hola")).toEqual([]);
  });
});

describe("renderTemplateBody", () => {
  it("rellena por posición", () => {
    expect(renderTemplateBody("Hola {{1}}, tu pedido {{2}} está listo.", ["Ana", "ORD-7"])).toBe(
      "Hola Ana, tu pedido ORD-7 está listo.",
    );
  });

  it("un {{n}} sin valor se deja tal cual", () => {
    expect(renderTemplateBody("{{1}} y {{2}}", ["solo-uno"])).toBe("solo-uno y {{2}}");
  });
});
