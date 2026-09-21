import { describe, expect, it } from "vitest";
import {
  bodyHasUnsupportedPlaceholders,
  renderTemplateBody,
  templateMaxIndex,
  templateRequiresUnsupportedParams,
  templateVariablesFromBody,
} from "./template-format";

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

  it("acota índices enormes o fuera de rango (no cuelga ni desborda)", () => {
    expect(templateMaxIndex("{{999999999}}")).toBe(0);
    expect(templateMaxIndex("Hola {{99}}")).toBe(0);
    expect(templateMaxIndex("{{50}}")).toBe(50);
  });
});

describe("bodyHasUnsupportedPlaceholders", () => {
  it("soportado: posicionales contiguos 1..N, o sin variables", () => {
    expect(bodyHasUnsupportedPlaceholders("Hola {{1}}, pedido {{2}}.")).toBe(false);
    expect(bodyHasUnsupportedPlaceholders("sin variables")).toBe(false);
    expect(bodyHasUnsupportedPlaceholders(null)).toBe(false);
  });

  it("no soportado: variables con nombre", () => {
    expect(bodyHasUnsupportedPlaceholders("Hola {{cliente}}")).toBe(true);
  });

  it("no soportado: fuera de rango o enormes", () => {
    expect(bodyHasUnsupportedPlaceholders("{{0}}")).toBe(true);
    expect(bodyHasUnsupportedPlaceholders("{{99}}")).toBe(true);
    expect(bodyHasUnsupportedPlaceholders("{{999999999}}")).toBe(true);
  });

  it("no soportado: posicionales con huecos ({{1}} y {{3}} sin {{2}})", () => {
    expect(bodyHasUnsupportedPlaceholders("{{1}} y {{3}}")).toBe(true);
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

describe("templateRequiresUnsupportedParams", () => {
  it("soportadas: solo BODY con variables, o encabezado/pie/botón estáticos", () => {
    expect(templateRequiresUnsupportedParams([{ type: "BODY", text: "Hola {{1}}" }])).toBe(false);
    expect(
      templateRequiresUnsupportedParams([
        { type: "HEADER", format: "TEXT", text: "Diluvium" },
        { type: "BODY", text: "Hola {{1}}" },
        { type: "FOOTER", text: "Gracias" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }, { type: "URL", text: "Web", url: "https://diluvium.com.mx" }] },
      ]),
    ).toBe(false);
    expect(templateRequiresUnsupportedParams([])).toBe(false);
    expect(templateRequiresUnsupportedParams(undefined)).toBe(false);
  });

  it("no soportadas: variable en encabezado de texto", () => {
    expect(
      templateRequiresUnsupportedParams([{ type: "HEADER", format: "TEXT", text: "Hola {{1}}" }, { type: "BODY", text: "x" }]),
    ).toBe(true);
  });

  it("no soportadas: encabezado de media (imagen/video/documento)", () => {
    expect(templateRequiresUnsupportedParams([{ type: "HEADER", format: "IMAGE" }])).toBe(true);
    expect(templateRequiresUnsupportedParams([{ type: "HEADER", format: "DOCUMENT" }])).toBe(true);
  });

  it("no soportadas: botón con URL dinámica o código", () => {
    expect(
      templateRequiresUnsupportedParams([{ type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.mx/{{1}}" }] }]),
    ).toBe(true);
    expect(templateRequiresUnsupportedParams([{ type: "BUTTONS", buttons: [{ type: "COPY_CODE", text: "Copiar" }] }])).toBe(true);
  });
});
