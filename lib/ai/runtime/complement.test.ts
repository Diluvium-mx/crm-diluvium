import { describe, expect, it } from "vitest";
import { HANDOVER_TOKEN, NOTHING_TOKEN, parseBrainOutput } from "./brain";
import { complementNote, partialNote, saidText, withoutClosingQuestions } from "./complement";

describe("señal «nada que agregar» (complemento de un workflow, 30-sep-2026)", () => {
  it("sola → nothing; con texto → el texto sin la señal; vacío sin señal sigue siendo vacío", () => {
    expect(parseBrainOutput(NOTHING_TOKEN)).toEqual({ kind: "nothing" });
    expect(parseBrainOutput(`  ${NOTHING_TOKEN}\n`)).toEqual({ kind: "nothing" });
    // 10-oct-2026: Luna la escribió con espacios 3 veces; también cuenta (y no queda como nota entre corchetes).
    expect(parseBrainOutput("[ NADA_QUE_AGREGAR ]")).toEqual({ kind: "nothing" });
    expect(parseBrainOutput("[nada que agregar]")).toEqual({ kind: "nothing" });
    expect(parseBrainOutput("[ TRANSFERIR ]")).toEqual({ kind: "reply", text: "", handover: true });
    expect(parseBrainOutput(`Somos de Mazatlán. ${NOTHING_TOKEN}`)).toEqual({ kind: "reply", text: "Somos de Mazatlán.", handover: false });
    expect(parseBrainOutput("   ")).toEqual({ kind: "empty" });
  });

  it("con la señal de pase a humano gana el pase a humano", () => {
    expect(parseBrainOutput(`${NOTHING_TOKEN} ${HANDOVER_TOKEN}`)).toEqual({ kind: "reply", text: "", handover: true });
  });
});

describe("notas del modo complemento", () => {
  it("la del complemento nombra al workflow, prohíbe preguntar y ofrece la señal exacta", () => {
    const note = complementNote("Precio 2", ["Precio"]);
    expect(note).toContain("«Precio 2»");
    expect(note).toContain("SIN hacer preguntas");
    expect(note).toContain(NOTHING_TOKEN);
  });

  it("ráfaga (9-oct-2026): nombra CADA mensaje del cliente y pide revisarlos todos, no solo el último", () => {
    const note = complementNote("Precio 2", ["¿Cuánto tarda el envío?", "Precio"]);
    expect(note).toContain("estos 2 mensajes seguidos: «¿Cuánto tarda el envío?» · «Precio»");
    expect(note).toContain("Revisa CADA uno, no solo el último");
    expect(note).toContain("«envío gratis» no dice cuánto tarda el envío");
    // Un solo mensaje: sin «seguidos».
    expect(complementNote("Precio 2", ["De que cd son y que precio tienen"])).toContain("el cliente mandó: «De que cd son y que precio tienen». Revisa si alguno");
  });

  it("ráfaga larga: solo los 8 más recientes", () => {
    const said = Array.from({ length: 10 }, (_, i) => `m${i + 1}`);
    const note = complementNote("Precio 2", said);
    expect(note).toContain("estos 10 mensajes seguidos: «m3»");
    expect(note).not.toContain("«m2»");
  });

  it("saidText: texto en una línea y recortado; nota de voz con su transcripción o sin ella; adjunto por tipo", () => {
    expect(saidText({ type: "text", body: "  Hola\n  buenas  " })).toBe("Hola buenas");
    expect(saidText({ type: "text", body: "x".repeat(200) })).toBe(`${"x".repeat(160)}…`);
    expect(saidText({ type: "audio", body: null, transcripcion: "mide cuatro metros" })).toBe("[nota de voz] mide cuatro metros");
    expect(saidText({ type: "audio", body: null, transcripcion: null })).toBe("[nota de voz sin transcribir]");
    expect(saidText({ type: "image", body: null })).toBe("[image]");
  });

  it("la parcial (el cliente siguió escribiendo) no ofrece la señal: hay que contestar", () => {
    const note = partialNote("Precio 2");
    expect(note).toContain("«Precio 2»");
    expect(note).not.toContain(NOTHING_TOKEN);
  });
});

describe("withoutClosingQuestions: el complemento no pregunta", () => {
  it("quita la pregunta final y conserva la información", () => {
    expect(withoutClosingQuestions(["Somos de Mazatlán, Sinaloa, y enviamos a todo México. ¿De dónde nos escribe?"])).toEqual({
      keep: ["Somos de Mazatlán, Sinaloa, y enviamos a todo México."],
      dropped: ["¿De dónde nos escribe?"],
    });
  });

  it("quita el mensaje que solo era pregunta (con emoji al final)", () => {
    expect(withoutClosingQuestions(["Somos de Mazatlán 📍", "¿Le gustaría que le cotice? 😊"])).toEqual({
      keep: ["Somos de Mazatlán 📍"],
      dropped: ["¿Le gustaría que le cotice? 😊"],
    });
  });

  it("pregunta pegada con coma: se quita y no deja la coma colgando", () => {
    expect(withoutClosingQuestions(["Enviamos a todo el país, ¿a qué ciudad sería?"]).keep).toEqual(["Enviamos a todo el país"]);
  });

  it("pregunta sin «¿»: se quita la última oración", () => {
    expect(withoutClosingQuestions(["La instalación es muy sencilla. Le interesa?"])).toEqual({
      keep: ["La instalación es muy sencilla."],
      dropped: ["Le interesa?"],
    });
  });

  it("dos preguntas seguidas al final: se quitan las dos", () => {
    expect(withoutClosingQuestions(["Sí, hay garantía. ¿Qué medida tiene? ¿Cuántas entradas?"]).keep).toEqual(["Sí, hay garantía."]);
  });

  it("una pregunta en medio (retórica) y cierre informativo no se toca", () => {
    const text = "¿Sabía que resiste hasta 50 cm? Además es reutilizable.";
    expect(withoutClosingQuestions([text])).toEqual({ keep: [text], dropped: [] });
  });

  it("sin preguntas, todo sale igual", () => {
    expect(withoutClosingQuestions(["Somos de Mazatlán.", "Enviamos gratis."])).toEqual({ keep: ["Somos de Mazatlán.", "Enviamos gratis."], dropped: [] });
  });
});
