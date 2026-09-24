import { describe, expect, it } from "vitest";
import { commandSchema, keywordsSchema, matchesKeyword, missingMedia, parseCommand, stepPayloadSchema, stepsSchema, stripUnresolvedVariables, unknownVariables } from "./steps";

describe("stepPayloadSchema", () => {
  it("acepta cada tipo de paso", () => {
    expect(stepPayloadSchema.parse({ kind: "send_text", text: " hola " })).toEqual({ kind: "send_text", text: "hola" });
    expect(stepPayloadSchema.parse({ kind: "send_media", assetId: null, title: "Tabla" })).toMatchObject({ assetId: null });
    expect(stepPayloadSchema.parse({ kind: "set_stage", stage: "compra" })).toEqual({ kind: "set_stage", stage: "compra" });
    expect(stepPayloadSchema.parse({ kind: "wait", seconds: 3 })).toEqual({ kind: "wait", seconds: 3 });
  });
  it("rechaza etapa desconocida, espera fuera de rango y texto vacío", () => {
    expect(() => stepPayloadSchema.parse({ kind: "set_stage", stage: "ganado" })).toThrow();
    expect(() => stepPayloadSchema.parse({ kind: "wait", seconds: 0 })).toThrow();
    expect(() => stepPayloadSchema.parse({ kind: "wait", seconds: 61 })).toThrow();
    expect(() => stepPayloadSchema.parse({ kind: "send_text", text: "   " })).toThrow();
    expect(() => stepPayloadSchema.parse({ kind: "explode" })).toThrow();
  });
  it("limita el número de pasos", () => {
    const many = Array.from({ length: 13 }, () => ({ kind: "wait", seconds: 1 }));
    expect(() => stepsSchema.parse(many)).toThrow();
  });
});

describe("missingMedia", () => {
  it("lista los archivos faltantes por título", () => {
    expect(
      missingMedia([
        { kind: "send_text", text: "x" },
        { kind: "send_media", assetId: null, title: "Tabla estándar" },
        { kind: "send_media", assetId: "a1", title: "Video" },
      ]),
    ).toEqual(["Tabla estándar"]);
  });
});

describe("comandos y palabras clave", () => {
  it("comando: /palabra en minúsculas", () => {
    expect(commandSchema.parse(" /Tabla ")).toBe("/tabla");
    expect(commandSchema.parse(null)).toBeNull();
    expect(() => commandSchema.parse("tabla")).toThrow();
    expect(() => commandSchema.parse("/con espacio")).toThrow();
    expect(parseCommand("/BANCO")).toBe("/banco");
    expect(parseCommand("/banco ahora")).toBeNull();
    expect(parseCommand("hola /banco")).toBeNull();
  });
  it("palabras clave: sin duplicados, coincidencia 'contiene' como GHL, sin mayúsculas ni acentos", () => {
    expect(keywordsSchema.parse(["Tabla", "tabla", "tamaños"])).toEqual(["tabla", "tamaños"]);
    expect(matchesKeyword("Me pasas la TABLA de tamanos?", ["tabla"])).toBe("tabla");
    expect(matchesKeyword("¿tienen tapón inflable?", ["tapon"])).toBe("tapon");
    expect(matchesKeyword("¿tienen tapones?", ["tapón"])).toBe("tapón"); // "contiene": tapon ⊂ tapones
    expect(matchesKeyword("¿cómo es la instalación?", ["instalacion"])).toBe("instalacion");
    expect(matchesKeyword("¿Qué tamaño son?", ["que tamaño son"])).toBe("que tamaño son");
    expect(matchesKeyword("quiero la tabla de tamaños", ["tabla de tamaños"])).toBe("tabla de tamaños");
    expect(matchesKeyword("hola, buenas tardes", ["tabla"])).toBeNull();
  });
  it("gana la palabra clave más larga; un mensaje largo también dispara (como GHL)", () => {
    expect(matchesKeyword("me mandas el video a la medida?", ["video", "video a la medida"])).toBe("video a la medida");
    expect(matchesKeyword("vi su video en facebook y quería saber cómo se instalan las compuertas", ["como se instalan"])).toBe("como se instalan");
    expect(matchesKeyword("video", ["video"])).toBe("video");
  });
  it("variables: solo las conocidas; las sin valor no salen al cliente", () => {
    expect(unknownVariables("Hola {{nombre}}, total {{monto}} y {{ cosa }}")).toEqual(["cosa"]);
    expect(stripUnresolvedVariables("Tu total es {{monto}} pesos")).toBe("Tu total es pesos");
  });
});
