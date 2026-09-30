import { describe, expect, it } from "vitest";
import { HANDOVER_TOKEN, NOTHING_TOKEN, parseBrainOutput } from "./brain";
import { complementNote, partialNote, withoutClosingQuestions } from "./complement";

describe("señal «nada que agregar» (complemento de un workflow, 30-sep-2026)", () => {
  it("sola → nothing; con texto → el texto sin la señal; vacío sin señal sigue siendo vacío", () => {
    expect(parseBrainOutput(NOTHING_TOKEN)).toEqual({ kind: "nothing" });
    expect(parseBrainOutput(`  ${NOTHING_TOKEN}\n`)).toEqual({ kind: "nothing" });
    expect(parseBrainOutput(`Somos de Mazatlán. ${NOTHING_TOKEN}`)).toEqual({ kind: "reply", text: "Somos de Mazatlán.", handover: false });
    expect(parseBrainOutput("   ")).toEqual({ kind: "empty" });
  });

  it("con la señal de pase a humano gana el pase a humano", () => {
    expect(parseBrainOutput(`${NOTHING_TOKEN} ${HANDOVER_TOKEN}`)).toEqual({ kind: "reply", text: "", handover: true });
  });
});

describe("notas del modo complemento", () => {
  it("la del complemento nombra al workflow, prohíbe preguntar y ofrece la señal exacta", () => {
    const note = complementNote("Precio 2");
    expect(note).toContain("«Precio 2»");
    expect(note).toContain("SIN hacer preguntas");
    expect(note).toContain(NOTHING_TOKEN);
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
