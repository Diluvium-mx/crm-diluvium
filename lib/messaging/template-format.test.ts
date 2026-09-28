import { describe, expect, it } from "vitest";
import {
  bodyHasUnsupportedPlaceholders,
  isTemplateEditable,
  renderTemplateBody,
  replaceBodyComponent,
  TEMPLATE_NAME_RE,
  templateBodyProblem,
  templateMaxIndex,
  templateNameFromLabel,
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

describe("templateNameFromLabel", () => {
  it("convierte lo que escribe el vendedor al nombre que exige Meta", () => {
    expect(templateNameFromLabel("Hola buenas tardes")).toBe("hola_buenas_tardes");
    expect(templateNameFromLabel("Hola, buenos días")).toBe("hola_buenos_dias");
    expect(templateNameFromLabel("  Seguimiento – Protección ¿Qué le pareció?  ")).toBe("seguimiento_proteccion_que_le_parecio");
    expect(templateNameFromLabel("Año 2026")).toBe("ano_2026");
  });

  it("un nombre ya válido queda igual", () => {
    expect(templateNameFromLabel("seguimiento_libre")).toBe("seguimiento_libre");
    expect(TEMPLATE_NAME_RE.test(templateNameFromLabel("Pago pendiente #2"))).toBe(true);
  });

  it("sin letras ni números queda vacío (el formulario lo pide)", () => {
    expect(templateNameFromLabel("¿¡ !?")).toBe("");
  });
});

describe("templateBodyProblem", () => {
  it("acepta texto sin variables o con variables en medio", () => {
    expect(templateBodyProblem("Hola, buenas tardes.", [])).toBeNull();
    expect(templateBodyProblem("Hola {{1}}, soy Daniel de Diluvium. {{2}} Quedo al pendiente.", ["Ana", "¿Pudiste ver la cotización?"])).toBeNull();
  });

  it("rechaza variable al inicio o al final (regla de Meta)", () => {
    expect(templateBodyProblem("{{1}}, buenas tardes.", ["Ana"])).toMatch(/empiece o termine/);
    expect(templateBodyProblem("Hola, soy Daniel. {{1}}", ["texto"])).toMatch(/empiece o termine/);
    expect(templateBodyProblem("  Hola {{1}}  ", ["Ana"])).toMatch(/empiece o termine/);
  });

  it("rechaza variables con nombre o con huecos", () => {
    expect(templateBodyProblem("Hola {{nombre}}, ¿cómo estás?", [])).toMatch(/con número y seguidas/);
    expect(templateBodyProblem("Hola {{1}} y {{3}}, ¿cómo están?", ["a", "b", "c"])).toMatch(/con número y seguidas/);
  });

  it("pide un ejemplo por variable, de una línea", () => {
    expect(templateBodyProblem("Hola {{1}}, ¿cómo estás?", [])).toMatch(/ejemplo para cada variable/);
    expect(templateBodyProblem("Hola {{1}}, ¿cómo estás?", [" "])).toMatch(/ejemplo para cada variable/);
    expect(templateBodyProblem("Hola {{1}}, ¿cómo estás?", ["Ana\nMaría"])).toMatch(/una sola línea/);
    expect(templateBodyProblem("Hola, ¿cómo estás?", ["Ana"])).toMatch(/no lleva ejemplos/);
  });

  it("vacío o demasiado largo", () => {
    expect(templateBodyProblem("   ", [])).toMatch(/Escribe el texto/);
    expect(templateBodyProblem(`Hola ${"a".repeat(1100)}.`, [])).toMatch(/hasta 1,024/);
  });
});

describe("isTemplateEditable", () => {
  it("solo aprobadas, rechazadas o pausadas (regla de Meta)", () => {
    expect(isTemplateEditable("APPROVED")).toBe(true);
    expect(isTemplateEditable("rejected")).toBe(true);
    expect(isTemplateEditable("PAUSED")).toBe(true);
    expect(isTemplateEditable("PENDING")).toBe(false);
    expect(isTemplateEditable("REMOVED")).toBe(false);
  });
});

describe("replaceBodyComponent", () => {
  it("cambia solo el BODY y conserva encabezado, pie y botones", () => {
    const current = [
      { type: "HEADER", format: "TEXT", text: "Diluvium" },
      { type: "BODY", text: "Hola {{1}}, ¿cómo estás?", example: { body_text: [["Ana"]] } },
      { type: "FOOTER", text: "Compuertas" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }] },
    ];
    const out = replaceBodyComponent(current, "Hola {{1}}, soy {{2}} de Diluvium.", ["Ana", "Daniel"]);
    expect(out).toEqual([
      { type: "HEADER", format: "TEXT", text: "Diluvium" },
      { type: "BODY", text: "Hola {{1}}, soy {{2}} de Diluvium.", example: { body_text: [["Ana", "Daniel"]] } },
      { type: "FOOTER", text: "Compuertas" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }] },
    ]);
    // No muta lo que recibió.
    expect(current[1]).toEqual({ type: "BODY", text: "Hola {{1}}, ¿cómo estás?", example: { body_text: [["Ana"]] } });
  });

  it("sin variables quita el ejemplo viejo", () => {
    expect(replaceBodyComponent([{ type: "body", text: "Hola {{1}}.", example: { body_text: [["Ana"]] } }], "Hola, buenas tardes.", [])).toEqual([
      { type: "body", text: "Hola, buenas tardes." },
    ]);
  });

  it("si no había BODY lo agrega al final", () => {
    expect(replaceBodyComponent([{ type: "HEADER", format: "TEXT", text: "X" }], "Hola.", [])).toEqual([
      { type: "HEADER", format: "TEXT", text: "X" },
      { type: "BODY", text: "Hola." },
    ]);
  });
});
