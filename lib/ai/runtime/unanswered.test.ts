import { describe, expect, it } from "vitest";
import { closingQuestion, isBareAck, onlyRepeatsLastQuestion, repeatNote, withoutUnansweredRepeat } from "./unanswered";

const PREGUNTA = "¿Usted tiene problemas de inundaciones?";

describe("pregunta sin contestar (3-oct-2026)", () => {
  it("closingQuestion: la pregunta final, con o sin «¿»; null si no termina en pregunta", () => {
    expect(closingQuestion(PREGUNTA)).toBe(PREGUNTA);
    expect(closingQuestion("Estamos en Los Mochis. ¿Usted tiene problemas de inundaciones? 🙂")).toBe("¿Usted tiene problemas de inundaciones? 🙂");
    expect(closingQuestion("Somos de Mazatlán. Le interesa?")).toBe("Le interesa?");
    expect(closingQuestion("Estamos en Los Mochis, Sinaloa.")).toBeNull();
  });

  it("caso c59b5197: contesta la ubicación y NO vuelve a hacer la misma pregunta (burbuja aparte)", () => {
    expect(withoutUnansweredRepeat(["Estamos en Los Mochis, Sinaloa, pero de aquí enviamos a todo México.", PREGUNTA], PREGUNTA)).toEqual({
      keep: ["Estamos en Los Mochis, Sinaloa, pero de aquí enviamos a todo México."],
      dropped: [PREGUNTA],
    });
  });

  it("con 1 sola burbuja (información + pregunta juntas) quita solo la pregunta; idéntica sin importar mayúsculas ni espacios", () => {
    expect(withoutUnansweredRepeat(["Tarda de 3 a 5 días hábiles.\n\n¿usted tiene  problemas de INUNDACIONES?"], PREGUNTA)).toEqual({
      keep: ["Tarda de 3 a 5 días hábiles."],
      dropped: ["¿usted tiene  problemas de INUNDACIONES?"],
    });
  });

  it("la pregunta del último mensaje va al final de un texto más largo (workflow o Agente IA con 1 burbuja)", () => {
    expect(withoutUnansweredRepeat(["Somos de Los Mochis.", PREGUNTA], `Ahorita tenemos cualquier tamaño en $5,500.\n\n${PREGUNTA}`)).toEqual({
      keep: ["Somos de Los Mochis."],
      dropped: [PREGUNTA],
    });
  });

  it("si solo iba la pregunta (el cliente dijo «ok»), sale tal cual: nunca silencio", () => {
    expect(withoutUnansweredRepeat([PREGUNTA], PREGUNTA)).toEqual({ keep: [PREGUNTA], dropped: [] });
  });

  it("otra pregunta (paráfrasis o la siguiente de la lista) sí sale; sin pregunta previa no se toca nada", () => {
    const otra = ["Estamos en Los Mochis.", "¿Cuántas entradas desea proteger?"];
    expect(withoutUnansweredRepeat(otra, PREGUNTA)).toEqual({ keep: otra, dropped: [] });
    expect(withoutUnansweredRepeat(["Claro.", "Para orientarle, ¿tiene problemas de inundaciones?"], PREGUNTA).dropped).toEqual([]);
    expect(withoutUnansweredRepeat(["Claro.", PREGUNTA], null)).toEqual({ keep: ["Claro.", PREGUNTA], dropped: [] });
  });

  it("caso 9801b330: la pregunta de las medidas tampoco se repite tras contestar la garantía", () => {
    const medir = "¿Habrá manera de medir la anchura de cada una de las entradas? De izquierda a derecha, para ver qué tamaño de compuertas le servirían.";
    // No termina en «?» (pregunta + explicación): igual no sale, porque es idéntica al último mensaje con pregunta.
    expect(withoutUnansweredRepeat(["Tiene un año de garantía.", medir], medir)).toEqual({ keep: ["Tiene un año de garantía."], dropped: [medir] });
  });
});

describe("pregunta sin contestar, parte 2 (5-oct-2026)", () => {
  it("onlyRepeatsLastQuestion: la respuesta es SOLO la pregunta repetida (con o sin mayúsculas/espacios)", () => {
    expect(onlyRepeatsLastQuestion([PREGUNTA], PREGUNTA)).toBe(true);
    expect(onlyRepeatsLastQuestion(["  ¿usted tiene problemas de INUNDACIONES? "], `Ahorita tenemos cualquier tamaño en $5,500.\n\n${PREGUNTA}`)).toBe(true);
    expect(onlyRepeatsLastQuestion(["Se coloca sin perforar.", PREGUNTA], PREGUNTA)).toBe(false);
    expect(onlyRepeatsLastQuestion(["¿Hasta qué nivel le sube el agua?"], PREGUNTA)).toBe(false);
    expect(onlyRepeatsLastQuestion([PREGUNTA], null)).toBe(false);
    expect(onlyRepeatsLastQuestion([], PREGUNTA)).toBe(false);
  });

  it("isBareAck: «ok», «gracias», emojis o un sticker sí; «Sí», preguntas, datos o una foto no", () => {
    const m = (body: string | null, types: string[] = []) => ({ body, attachments: types.map((type) => ({ type })) });
    for (const t of ["Ok", "okey!", "Va", "Gracias", "Muchas gracias 🙏", "Perfecto, gracias", "👍", "👌🏼"]) expect(isBareAck(m(t)), t).toBe(true);
    expect(isBareAck(m(null, ["sticker"]))).toBe(true);
    for (const t of ["Sí", "Si", "Quiero más información", "Bueno a estado lloviendo mucho", "ok y cuánto cuesta?", "2"]) expect(isBareAck(m(t)), t).toBe(false);
    expect(isBareAck(m(null, ["image"]))).toBe(false);
    expect(isBareAck(m(null, ["audio"]))).toBe(false);
  });

  it("repeatNote menciona la pregunta y pide no repetirla", () => {
    const note = repeatNote(PREGUNTA);
    expect(note).toContain(PREGUNTA);
    expect(note).toContain("No la repitas");
  });
});
