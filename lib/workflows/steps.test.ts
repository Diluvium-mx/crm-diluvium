import { describe, expect, it } from "vitest";
import { commandSchema, endsWithQuestion, endsWithQuestionStep, keywordsSchema, lastSendIndex, maxSendsLabel, maxSendsSchema, START_SCOPE_LABEL, startOnlyApplies, startScopeFields, startScopeOf, matchesKeyword, missingMedia, parseCommand, stepPayloadSchema, stepsSchema, stripUnresolvedVariables, unknownVariables, waitMs } from "./steps";

describe("stepPayloadSchema", () => {
  it("acepta cada tipo de paso", () => {
    expect(stepPayloadSchema.parse({ kind: "send_text", text: " hola " })).toEqual({ kind: "send_text", text: "hola" });
    expect(stepPayloadSchema.parse({ kind: "send_media", assetId: null, title: "Tabla" })).toMatchObject({ assetId: null });
    expect(stepPayloadSchema.parse({ kind: "wait", seconds: 3 })).toEqual({ kind: "wait", seconds: 3 });
  });
  it("rechaza etapa desconocida, espera fuera de rango y texto vacío", () => {
    expect(() => stepPayloadSchema.parse({ kind: "set_stage", stage: "interesado" })).toThrow(); // ya no existe como paso
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
  it("comando con ñ (/tamaños): se acepta, en minúsculas y igual si la ñ llega descompuesta; acentos no", () => {
    const decomposed = "/taman\u0303os"; // "n" + tilde combinada (texto pegado)
    expect(commandSchema.parse(" /Tamaños ")).toBe("/tamaños");
    expect(commandSchema.parse("/ÑANDU")).toBe("/ñandu");
    expect(commandSchema.parse(decomposed)).toBe("/tamaños");
    expect(() => commandSchema.parse("/tamaño-estándar")).toThrow(/la ñ sí/);
    expect(() => commandSchema.parse("/-tamaños")).toThrow();
    expect(parseCommand("/TAMAÑOS")).toBe("/tamaños");
    expect(parseCommand(decomposed)).toBe("/tamaños");
    expect(parseCommand("/tamaños por favor")).toBeNull();
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
    // Solo signos de pesos = pregunta de precio (5-oct-2026).
    expect(matchesKeyword("$", ["cuesta", "costo", "precio"])).toBe("precio");
    expect(matchesKeyword(" $$$ ", ["precio"])).toBe("precio");
    expect(matchesKeyword("¿$?", ["precio"])).toBe("precio");
    expect(matchesKeyword("$", ["tabla"])).toBeNull(); // sin la palabra «precio» no dispara nada
    expect(matchesKeyword("$500", ["precio"])).toBeNull(); // trae número: se compara normal
    expect(matchesKeyword("$ precio?", ["precio"])).toBe("precio");
    expect(matchesKeyword("???", ["precio"])).toBeNull();
  });
  it("gana la palabra clave más larga; un mensaje largo también dispara (como GHL)", () => {
    expect(matchesKeyword("me mandas el video a la medida?", ["video", "video a la medida"])).toBe("video a la medida");
    expect(matchesKeyword("vi su video en facebook y quería saber cómo se instalan las compuertas", ["como se instalan"])).toBe("como se instalan");
    expect(matchesKeyword("video", ["video"])).toBe("video");
  });
  it("variables: solo las conocidas; las sin valor no salen al cliente", () => {
    expect(unknownVariables("Hola {{nombre}}, de {{vendedor}} y {{ cosa }}")).toEqual(["cosa"]);
    expect(stripUnresolvedVariables("Te atiende {{vendedor}} hoy")).toBe("Te atiende hoy");
  });
});

describe("waitMs (pasos Esperar)", () => {
  it("se salta SOLO con un / del vendedor (trigger command); agente, palabra clave y etapa esperan", () => {
    const step = { kind: "wait" as const, seconds: 30 };
    expect(waitMs(step, "command")).toBe(0);
    expect(waitMs(step, "agent")).toBe(30_000);
    expect(waitMs(step, "keyword")).toBe(30_000);
    expect(waitMs(step, "stage")).toBe(30_000);
  });
});

describe("endsWithQuestion / endsWithQuestionStep (pregunta duplicada, 28-sep-2026)", () => {
  it("pregunta = '?' al final, seguido si acaso de espacios, emojis o signos; nunca de letras o números", () => {
    expect(endsWithQuestion("¿Usted tiene problemas de inundaciones?")).toBe(true);
    expect(endsWithQuestion("  ¿Usted tiene problemas de inundaciones? 🙌 \n")).toBe(true);
    expect(endsWithQuestion("¿De qué medida es su entrada?!")).toBe(true);
    expect(endsWithQuestion("¿Le interesa? Aquí está el video")).toBe(false);
    expect(endsWithQuestion("Ahorita tenemos cualquier tamaño en $5,500 con envío gratis")).toBe(false);
    expect(endsWithQuestion("¿Cuántas entradas? 2")).toBe(false);
    expect(endsWithQuestion("")).toBe(false);
    expect(endsWithQuestion(null)).toBe(false);
  });
  it("solo cuenta el ÚLTIMO paso (texto o pie de la imagen/video); una espera al final no es pregunta", () => {
    const tabla = { kind: "send_media" as const, assetId: "a1", title: "Tabla", caption: "Estos son los tamaños que manejamos" };
    expect(endsWithQuestionStep([tabla, { kind: "send_text", text: "¿Usted tiene problemas de inundaciones?" }])).toBe(true);
    expect(endsWithQuestionStep([{ kind: "send_text", text: "¿Le mando la tabla?" }, tabla])).toBe(false);
    expect(endsWithQuestionStep([{ ...tabla, caption: "¿Cuál le queda a su entrada?" }])).toBe(true);
    expect(endsWithQuestionStep([{ kind: "send_text", text: "¿Tiene inundaciones?" }, { kind: "wait", seconds: 5 }])).toBe(false);
    expect(endsWithQuestionStep([])).toBe(false);
  });
});

describe("«¿Cuándo se dispara…?»: tres opciones (29-sep-2026)", () => {
  it("dos columnas ↔ tres opciones; el historial anterior (sin la segunda columna) es la regla estricta", () => {
    expect(startScopeOf({ triggerStartOnly: false, triggerStartOnlyAgent: true })).toBe("siempre");
    expect(startScopeOf({ triggerStartOnly: false, triggerStartOnlyAgent: false })).toBe("siempre");
    expect(startScopeOf({ triggerStartOnly: true, triggerStartOnlyAgent: true })).toBe("inicio");
    expect(startScopeOf({ triggerStartOnly: true, triggerStartOnlyAgent: false })).toBe("inicio_palabra_clave");
    expect(startScopeOf({ triggerStartOnly: true })).toBe("inicio");
    expect(startScopeOf({})).toBe("siempre");
    for (const scope of ["siempre", "inicio", "inicio_palabra_clave"] as const) expect(startScopeOf(startScopeFields(scope))).toBe(scope);
    expect(START_SCOPE_LABEL.inicio_palabra_clave).toBe("Solo al inicio por palabra clave; el Agente IA cuando haga falta");
  });

  it("a qué disparador aplica: la palabra clave siempre; el Agente IA solo en la regla estricta; comando y etapa nunca", () => {
    const estricto = { triggerStartOnly: true, triggerStartOnlyAgent: true };
    const tabla = { triggerStartOnly: true, triggerStartOnlyAgent: false };
    expect([startOnlyApplies(estricto, "keyword"), startOnlyApplies(estricto, "agent"), startOnlyApplies(estricto, "command"), startOnlyApplies(estricto, "stage")]).toEqual([true, true, false, false]);
    expect([startOnlyApplies(tabla, "keyword"), startOnlyApplies(tabla, "agent")]).toEqual([true, false]);
    expect(startOnlyApplies({ triggerStartOnly: false, triggerStartOnlyAgent: true }, "keyword")).toBe(false);
  });
});

describe("«Máximo de envíos por chat» y «El workflow es la respuesta» (29-sep-2026)", () => {
  it("máximo: 1–20 o vacío (sin límite)", () => {
    expect(maxSendsSchema.parse(2)).toBe(2);
    expect(maxSendsSchema.parse(null)).toBeNull();
    expect(maxSendsSchema.safeParse(0).success).toBe(false);
    expect(maxSendsSchema.safeParse(21).success).toBe(false);
    expect(maxSendsSchema.safeParse(1.5).success).toBe(false);
    expect([maxSendsLabel(null), maxSendsLabel(1), maxSendsLabel(2)]).toEqual(["sin límite", "1 vez", "2 veces"]);
  });

  it("el último paso que le llega al cliente (una espera al final no cuenta)", () => {
    expect(lastSendIndex([{ kind: "wait", seconds: 18 }, { kind: "send_media", assetId: "a", title: "Tabla" }])).toBe(1);
    expect(lastSendIndex([{ kind: "send_text", text: "hola" }, { kind: "wait", seconds: 2 }])).toBe(0);
    expect(lastSendIndex([{ kind: "wait", seconds: 2 }])).toBe(-1);
    expect(lastSendIndex([])).toBe(-1);
  });
});
